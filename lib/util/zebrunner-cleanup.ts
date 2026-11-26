// Fork (Zebrunner): what the cleanup between the uses of a device keeps (lib/units/device/plugins/cleanup.ts of
// Android, lib/units/ios-device/plugins/cleanup.ts of iOS) besides the apps the device had when its unit started.
// The farm installs helpers after the start (the server of UiAutomator2 and the settings of Appium on the first
// session, the apps of the configuration of the MDM, WebDriverAgent again after a failure): without this list the
// cleanup would remove them after every use and the next one would install them again, or fight the MDM.

// keepMatcher <patterns>: whether the cleanup keeps an app (an Android package, an iOS bundle id). A pattern is an
// exact id or a prefix that ends with '*' ('com.hmdm.*'); a value may hold several separated by commas or spaces,
// as an environment variable gives a list of the CLI (STF_PROVIDER_CLEANUP_KEEP_PACKAGES="a,b" is one value)
export function keepMatcher(patterns?: readonly unknown[]): (id: string) => boolean {
  var exact = new Set<string>()
  var prefixes: string[] = []
  ;(patterns || [])
    .flatMap(function(pattern) {
      return String(pattern).split(/[\s,]+/)
    })
    .filter(Boolean)
    .forEach(function(pattern) {
      if (pattern.endsWith('*')) {
        prefixes.push(pattern.slice(0, -1))
      }
      else {
        exact.add(pattern)
      }
    })
  return function(id: string) {
    return exact.has(id) || prefixes.some(function(prefix) {
      return id.startsWith(prefix)
    })
  }
}
