#!/bin/bash
# Fork (Zebrunner): boots an iOS simulator and starts WebDriverAgent on it for test/zebrunner-ios,
# see .github/workflows/zebrunner-ios.yml. Prints the UDID of the simulator.
#
# usage: zebrunner-ios-simulator.sh <ios-major> [<runtime-version-to-download>]
# The simulator and WebDriverAgent keep running; stop them with `xcrun simctl shutdown <udid>`.
# env:   WDA_REF (the WebDriverAgent tag), WDA_DIR (where to clone it), LOG_DIR
set -euo pipefail

ios_major="$1"
download_version="${2:-}"
wda_ref="${WDA_REF:-v16.15.0}"
wda_dir="${WDA_DIR:-$PWD/.wda}"
log_dir="${LOG_DIR:-$PWD/ios-logs}"
mkdir -p "$log_dir"

note() {
  echo "=== $* ===" >&2
}

# runtime <major>: the identifier of the newest installed iOS runtime of that major version
runtime() {
  xcrun simctl list runtimes -j | node -e "
    let d = ''
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', () => {
      const found = JSON.parse(d).runtimes
        .filter((r) => r.platform === 'iOS' && r.isAvailable && r.version.split('.')[0] === '$1')
        .sort((a, b) => a.version.localeCompare(b.version, undefined, {numeric: true}))
        .pop()
      process.stdout.write(found ? found.identifier : '')
    })"
}

# iphone <runtime>: the newest iPhone type the runtime supports, by the iOS version it came with
iphone() {
  local types
  types=$(xcrun simctl list devicetypes -j)
  xcrun simctl list runtimes -j | TYPES="$types" node -e "
    let d = ''
    process.stdin.on('data', (c) => { d += c })
    process.stdin.on('end', () => {
      const since = {}
      JSON.parse(process.env.TYPES).devicetypes.forEach((t) => { since[t.identifier] = t.minRuntimeVersion || 0 })
      const r = JSON.parse(d).runtimes.find((r) => r.identifier === '$1')
      const phones = (r.supportedDeviceTypes || [])
        .filter((t) => t.productFamily === 'iPhone')
        .sort((a, b) => (since[a.identifier] || 0) - (since[b.identifier] || 0))
      process.stdout.write(phones.length ? phones[phones.length - 1].identifier : '')
    })"
}

note "Xcode: $(xcodebuild -version | tr '\n' ' ')"
runtime_id=$(runtime "$ios_major")
if [[ -z "$runtime_id" && -n "$download_version" ]]; then
  note "downloading the iOS $download_version runtime"
  # xcodes also has the runtimes Xcode no longer offers, and installs them as root
  xcodebuild -downloadPlatform iOS -buildVersion "$download_version" >&2 ||
    sudo xcodes runtimes install "iOS $download_version" >&2 ||
    true
  runtime_id=$(runtime "$ios_major")
fi
if [[ -z "$runtime_id" ]]; then
  echo "::error::no iOS $ios_major simulator runtime for this Xcode" >&2
  xcrun simctl list runtimes >&2
  exit 1
fi

device_type=$(iphone "$runtime_id")
note "runtime $runtime_id, device $device_type"
udid=$(xcrun simctl create "stf-ios-$ios_major" "$device_type" "$runtime_id")
xcrun simctl boot "$udid"
xcrun simctl bootstatus "$udid" -b >&2

if [[ ! -d "$wda_dir" ]]; then
  note "cloning WebDriverAgent $wda_ref"
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$wda_ref" https://github.com/appium/WebDriverAgent "$wda_dir"
fi

note "building WebDriverAgent"
destination="platform=iOS Simulator,id=$udid,arch=$(uname -m)"
xcodebuild build-for-testing \
  -project "$wda_dir/WebDriverAgent.xcodeproj" \
  -scheme WebDriverAgentRunner \
  -destination "$destination" \
  -derivedDataPath "$wda_dir/build" \
  CODE_SIGNING_ALLOWED=NO > "$log_dir/wda-build.log" 2>&1 ||
  {
    tail -50 "$log_dir/wda-build.log" >&2
    exit 1
  }

note "starting WebDriverAgent"
# The runner app starts its tests itself when launched, `xcodebuild test` hung on iOS 16
runner="$wda_dir/build/Build/Products/Debug-iphonesimulator/WebDriverAgentRunner-Runner.app"
xcrun simctl install "$udid" "$runner"
xcrun simctl launch --console-pty "$udid" com.facebook.WebDriverAgentRunner.xctrunner \
  > "$log_dir/wda.log" 2>&1 &
echo $! > "$log_dir/wda.pid"

# The first launch on an older runtime takes minutes
for _ in $(seq 1 300); do
  if curl -sf http://127.0.0.1:8100/status > /dev/null; then
    note "WebDriverAgent is up"
    echo "$udid"
    exit 0
  fi
  sleep 2
done
tail -50 "$log_dir/wda.log" >&2
echo "::error::WebDriverAgent did not start" >&2
exit 1
