# Zebrunner STF

The STF of [Zebrunner MCloud](https://github.com/zebrunner/mcloud): a fork of [DeviceFarmer/stf](https://github.com/DeviceFarmer/stf) that adds iOS and tvOS devices, the sign-in through Zebrunner, the device status API of the Zebrunner device management and the authentication of the storage. Everything else is upstream STF; [README.md](README.md) and [doc/](doc/) describe it.

The image `public.ecr.aws/zebrunner/stf` runs the STF units of [mcloud](https://github.com/zebrunner/mcloud) and is the base of the device image [mcloud-device](https://github.com/zebrunner/mcloud-device), which runs one provider (Android) or one `ios-device` unit (iOS, tvOS) per device, started by [mcloud-agent](https://github.com/zebrunner/mcloud-agent).

## What the fork adds

| Feature | Where |
| --- | --- |
| iOS/tvOS device unit: screen, touch, keys, install of `.ipa`, clipboard, Wi-Fi and Bluetooth through WebDriverAgent; device log, shell and files through go-ios, see [iOS devices](#ios-devices) | `lib/units/ios-device/`, `lib/cli/ios-device/` |
| iOS messages of the wire protocol and the ports of an Android device worker (`DevicePortsMessage`), codes 98-130 (the retired ones are reserved); the node proof of a device registration in `DevicePortsMessage` and `InitializeIosDeviceState` | `lib/wire/wire.proto` (after the upstream messages) |
| iOS device state in the database, the screen and connect ports of the Android devices | `lib/db/zebrunner.ts`, `lib/units/processor/` |
| Sign-in through the Zebrunner IAM service | `lib/units/auth/zebrunner.ts`, `lib/cli/auth-zebrunner/`, `res/app/src/entries/auth-zebrunner.tsx` |
| Device status, size, owner and type routes of the REST API | `lib/units/api/controllers/zebrunner.ts`, `lib/units/api/helpers/device-status.ts` |
| `stf token-add`: the access token of the admin without a sign-in, for the setup of mcloud, see [Access token of the admin](#access-token-of-the-admin) | `lib/cli/token-add/` |
| Access tokens kept as the hashes of the tokens, with an optional expiry (`ttl`); `stf migrate` hashes the tokens of an earlier STF, see [Access tokens](#access-tokens) | `lib/util/zebrunner-access-tokens.ts`, `lib/db/api.ts`, `lib/cli/migrate/` |
| Authentication of the storage routes and SSRF protection of downloads | `lib/util/storageauth.ts`, `lib/util/urlsafety.ts` |
| The authorization of the grid of mcloud: stf-proxy lets a request of the hub, the console or the admin routes of the grid in for the user of an access token (or of the session cookie for the console), see [Grid authentication](#grid-authentication) | `lib/units/api/controllers/zebrunner-hub-auth.ts` |
| Enrolled device hosts ("nodes"): one-time invites, per-node tokens, revocation, the CURVE keys of the nodes in the ZAP handler of the triproxies, node tokens in the storage, the node binding of the devices, the screen authorization of stf-proxy, the devices of the adb relay and the opt-in WireGuard tunnel of the nodes (their addresses, keys and the peers of the head), see [Nodes (enrollment)](#nodes-enrollment) | `lib/util/zebrunner-nodes*.ts`, `lib/db/zebrunner-nodes.ts`, `lib/units/api/controllers/zebrunner-nodes.ts`, `lib/units/processor/zebrunner-nodes.ts` |
| One provider per device container: fixed VNC port, fixed connect port (`STF_PROVIDER_CONNECT_PORT`), `UNHEALTHY` and exit when the device cannot be provided or the processor does not ack its registration, see [ZeroMQ](#zeromq) | `lib/cli/provider/`, `lib/units/provider/` |
| `.ipa` manifests (Info.plist) in the apk storage plugin | `lib/units/storage/plugins/apk/task/` |
| The WebSocket sends the commands of a user (input, shell, install, remote ADB, files, ...) to the devices the user uses only (an admin: to any device), the invitations to the devices of the groups of the user, and subscribes the client to the channels of its transactions only: the channel of a device is `base64(sha1(serial))`, so any user controlled any device. A released device gets no command later than 2 s after it | `lib/units/websocket/zebrunner-channels.ts`, `lib/db/zebrunner.ts` |
| A malformed ZeroMQ message or WebSocket event (or a listener failing on it) is logged once a minute and dropped instead of ending the unit: the listeners run in `process.nextTick`, so their exceptions were uncaught | `lib/util/zebrunner-guard.ts`, `lib/wire/router.ts`, `lib/units/websocket/index.ts` |
| The cleanup between the uses of a device: the apps installed since the first start of the unit are uninstalled (but the helpers of the farm, `--cleanup-keep-packages`), also on iOS (go-ios), then the state a user can leave for the next one is reset: the global proxy, Private DNS, accessibility services, clipboard, Wi-Fi networks and downloads of Android, the configuration profiles (and their root certificates) of iOS, each step can be left out (`--cleanup-reset`), see [Cleanup between uses](#cleanup-between-uses) | `lib/util/zebrunner-cleanup.ts`, `lib/util/zebrunner-reset.ts`, `lib/units/device/plugins/cleanup.ts`, `lib/units/ios-device/plugins/cleanup.ts` |
| Android rotation: the rotation of the user is always locked (STFService thawed an unlocked one at once, the sensors turned a device standing in a rack back to portrait), a rotated device is turned back to a locked portrait with the auto-rotate setting it had before when it is released, also without the screen reset (no Home); `--lock-rotation` is ignored | `lib/units/device/plugins/service.ts`, `lib/units/device/plugins/group.ts` |
| UI: iOS/tvOS controls, the app under `/stf`, device list filter and scroll position | `res/app/src/` (`zebrunner` in the file name, or marked `Fork (Zebrunner)`) |
| The cookies of an https deployment are Secure whatever the headers of the request, the address of the client is the one stf-proxy saw; `GET /auth/contact` tells the admin to the signed-in users only, `GET /api/v1/users` lists the users of the groups of a user (every user to an admin), the description of the API needs a user, see [Sessions](#sessions) and [REST API](#rest-api) | `lib/util/zebrunner-session.ts`, `lib/util/zebrunner-contact.ts`, `lib/units/api/controllers/users.ts`, `res/app/src/features/settings/groups/` |
| The REST API keeps the owner of an absent device for an admin and for the owner, as it answers `using` (upstream hid it): a device whose host went away during a session stays controlled. Settings > Devices tells why the API did not remove a device (`Unchanged`): it does not match the removing filters (present, booked, annotated, controlled), such a controlled device needs them at Any | `lib/util/datautil.ts`, `res/app/src/features/settings/devices/` |

## iOS devices

The device page of an iOS device has the tabs of an Android one, served by `lib/units/ios-device/plugins/`:

| Feature | How | Limits |
| --- | --- | --- |
| Logs | `ios syslog`, the process is the tag (`devicelog.ts`) | the time is the one the unit received the line |
| Shell (Dashboard) | go-ios commands, `ios` in front is optional: `apps --list`, `info`, `ps`, `launch <bundle id>`, `kill <bundle id>`, `crash ls`, `lang`, `setlocation`, ... (`shell.ts`) | only the commands, subcommands (right after the command) and options of the allow list of `util/goios.ts`, an option value after `=`; `--udid`, tunnels, credentials and files of the container are refused |
| File Explorer | the media directory (AFC: `DCIM`, `Downloads`, ...) through `ios fsync tree` and `ios fsync pull` (`filesystem.ts`) | no sizes, dates or permissions; a directory is listed with its whole tree, a large one takes a while |
| Wi-Fi, Bluetooth (Advanced) | opens their page of Settings through WDA, reads or taps the switch, then brings back the app that was in front (`radio.ts`, `wda/settings.ts`); a lookup while a page still moves is tried again, a switch a tap at the middle of its row misses (the full-width switches of iOS 18) is tapped at its knob | takes the screen for 5-8 seconds, so the state is read on demand only; Wi-Fi is turned off only on a device connected by USB (`ios list --details`); not on tvOS |
| Screenshots | WDA | |
| Taps, long press, double tap (screen) | the point of the UI in the points of WDA: the natural (portrait) size of the screen from WDA (`devicestate.ts`), turned for a landscape screen of either side and kept within the screen, the same way as the swipes and the gestures (`wda/gesture.ts` toDevice) | |
| Gestures (screen) | the UI records the path of every finger with its timing (Alt with the mouse adds the mirrored finger of a pinch) and draws its trail over the screen; when the gesture ends it goes to the unit as `TouchPathIosMessage` and WDA replays it as W3C actions on at most 6 ticks of the path, since WDA spends ~0.25 s on every move (`wda/gesture.ts`, `res/app/src/features/control/screen/ios-gesture.ts`); a click stays a tap or a long press | iOS takes no live touches without a jailbreak, so the device gets the gesture once it ends; no gestures on tvOS |
| Back and Recents (menu of the screen) | Back taps the back button of the navigation bar of the app in front (the first button of a navigation bar, on the left third of the screen), else the "◀ <app>" breadcrumb of the status bar (looked for in SpringBoard) to the app that opened this one, else does nothing; Recents swipes up from the bottom edge and holds at 78% of the height, or presses Home twice on an iPhone with the Home button (`wda/navigation.ts`); a button WDA has not is logged instead of stopping the unit | no Back in an app without a navigation bar (a swipe from the edge could do something else there); Recents on Apple TV is not supported, Back is Menu |
| Speed of taps and gestures | a WDA session STF creates (no Appium test runs) gets `snapshotMaxDepth=1`, `waitForIdleTimeout=0`, `animationCoolOffTimeout=0`: WDA snapshots the app for every move of `/actions`, a tap takes 0.4 s instead of 1.4 s (`wda/fast-input.ts`); the automations that look for elements run with the defaults, which come back when the session ends | a session of Appium keeps its own settings (WDA resets them in every new session), so the screen of a running test keeps the slower taps |
| Clipboard (Dashboard) | WDA reads and writes the pasteboard with its runner in front for a moment (iOS 16+ gives the pasteboard to the app in front only), then the app that was in front comes back; paste also types the text into the focused field, like Android (`clipboard.ts`, `wda/pasteboard.ts`) | about 2-3 seconds; WDA accepts the "Allow Paste" alert itself |
| Apps (Dashboard) | Settings, its Wi-Fi page, General > iPhone Storage (Manage Apps) and Developer, opened through WDA (`radio.ts`, `wda/settings.ts`) | only Settings and the App Store on tvOS |
| Reboot (Dashboard) | `ios reboot` (`reboot.ts`), answered when go-ios asked the device to restart, with the error of go-ios when it failed | the device leaves STF until it is back |
| Info | hardware, iOS build, CPU architecture, SIM, storage and battery (temperature, voltage, health) from lockdown through `ios info`, `ios diskspace` and `ios batteryregistry` (`info/index.ts`, the battery every 5 minutes); marketing name, release date, CPU, RAM, screen size, ppi and refresh rate of the model by its ProductType (`lib/util/zebrunner-ios-models.json`, 133 iPhone and iPad models up to October 2026, from Wikipedia and Apple; add the new models there) | RAM is the smallest of a model; Airplane Mode is read from the root page of Settings whenever the unit opens Settings (Wi-Fi, Bluetooth, the Apps shortcuts), iOS logs it only when it changes; roaming and the cellular technology are not known |
| Network (Info) | the system log through `ios ostrace` (no tunnel) for up to 15 seconds every 5 minutes: the primary interface (`symptomsd`) and the Wi-Fi link, SSID, RSSI, SNR, channel and bandwidth (`wifid`); `IosNetworkEvent` | the log costs the device some CPU while it is read |

There is no port forwarding (iOS cannot run the reverse proxy of Android), no remote debug, ringer mode or bonded Bluetooth devices. go-ios reaches the device through usbmuxd (`USBMUXD_SOCKET_ADDRESS` of mcloud-device). The developer services of iOS 17+ (`ps`, `launch`, `kill`, `info display`, `devicestate`, ...) need a tunnel: the unit runs none, go-ios uses the userspace tunnel the connector container (mcloud-ios-connector) shares for iOS newer than 17.4.0 (`GO_IOS_AGENT_HOST=connector` of mcloud-device, the tunnel API on port 60105). iOS 17.0-17.4.0 has no shared tunnel, so these commands fail there, and a device with `WIRELESS=true` has no go-ios features at all.

The type of the device (iPhone or Apple TV, by the `userInterfaceIdiom` or else the `model` of `/wda/device/info`, never by its name), its screen and its iOS version come from WebDriverAgent without a session when the unit starts (`devicestate.ts`, read again on the next join while WDA fails): the unit sends them to the processor (`IosDeviceScreenMessage`, `SdkIosVersion`), which stores them for the API, the grid and the UI. The platform of the device (`iOS` or `tvOS`) follows the type: the unit registers the device with it (`iOS` while WDA cannot tell the type) and the processor sets it again with every type it gets. The device units (`ios-device`, and `device` of Android) have no database: only the units of the server connect to RethinkDB, the device containers get no address of it.

## Image contents

| Component | Why |
| --- | --- |
| Ubuntu 26.04, STF with the fork, Node.js 22 | the STF units; the build tools stay in the build stage |
| bundletool 1.18.3, OpenJDK 21 (JRE) | converts the uploaded `.aab` files into `.apk` files (storage-temp) |
| GraphicsMagick, TurboJPEG | resize the images and the screenshots (storage-plugin-image) |
| `libplist-utils` (`plistutil`) | reads the binary `Info.plist` of uploaded `.ipa` files |
| iOS, Android and tvOS icons (`icon/`) | the icons of the device list; `@devicefarmer/stf-device-db` 2 draws the other device pictures as SVG |

go-ios, socat and curl, which the `ios-device` unit and the scripts of the device containers use, are installed by the mcloud-device image.

## Build

```bash
make build VERSION=3.1   # public.ecr.aws/zebrunner/stf:3.1 in the local docker
make push VERSION=3.1    # linux/amd64 and linux/arm64 built by docker buildx and pushed: docker login public.ecr.aws first
```

`make build` builds the image for the platform of this machine, `make push` builds `linux/amd64` and `linux/arm64`
(`PLATFORMS`) with `docker buildx` and pushes them as one multi-platform image, which mcloud-device builds on.
`IMAGE_REPO` sets another repository, `VERSION` is the tag and the `org.opencontainers.image.version` label (`dev` by
default, required by `push`). `make push` uses the buildx builder `mcloud` (docker-container driver), which it creates
once; the other platform is built emulated by QEMU (`docker run --privileged --rm tonistiigi/binfmt --install all`),
which takes long for the native modules: the `Publish` job of CI builds every platform on a runner of its own instead
and pushes it by digest (`PUSH_OUTPUT` of `make push`), then joins them with `docker buildx imagetools create`.
The base image `ubuntu:26.04` is pinned by the digest of its multi-platform index (Dependabot updates it), the Node.js
tarballs by their sha256 of `SHASUMS256.txt` of nodejs.org: a new Node.js version changes `.nvmrc`, the URLs and the sums
in `Dockerfile`. The image is built for `linux/amd64` and `linux/arm64` only, another platform stops the build.
The layers of `Dockerfile` go from the least to the most often changed: the build packages and Node.js, `npm ci` of
`package.json` and `package-lock.json` (stage `deps`, with a cache mount of the npm cache), the `node_modules` of the
image (`prod-deps`, `npm prune --omit=dev`), then the sources and their build (`build`, `npm pack`). A change of the
sources only rebuilds the last stage (15 s instead of 2-3 min on the build host) and changes a 9.5 MB layer of the image
instead of 160 MB; CI keeps the layers in the buildx cache of GitHub Actions (`type=gha`: scope `compose-amd64` of the
Compose job, `docker-arm64` of the `Docker` workflow).

The file `VERSION` is the release of the fork in work (bumped by hand after a release), the tag of the image; the `version` of `package.json` is the upstream release the fork is merged with (`CHANGELOG.md`), it is not the version of the fork. The `Publish` job of CI pushes the image of
every merge into `develop` after `Report` passed (on a push without the device legs, see [CI](#ci)): `public.ecr.aws/zebrunner/stf:<VERSION>-develop-<sha>` (7 characters
of the commit) and `<VERSION>-develop-latest`, by the reusable workflow `docker-publish.yml` of
[mcloud-conventions](https://github.com/zebrunner/mcloud-conventions) over `make push`.
The workflows of upstream publish nothing from the fork: `Docker` (`docker.yml`) only builds the images of the pull
requests (the arm64 one: the Compose job of CI builds and tests the amd64 image), `Docker Debian`
(`zebrunner-docker-debian.yml`) the Debian image of upstream (`Dockerfile-debian-x86_64`) when a pull request changes
it, `package.json`, `package-lock.json` or `.dockerignore`, `Prepare release` and `Release` (the npm package
`@devicefarmer/stf` and the Docker Hub image `devicefarmer/stf`) run in DeviceFarmer/stf only.

Without docker (Node.js 22.18 or later):

```bash
npm ci
node build.mts build
```

`make help` lists the targets; `make check` runs the lint and the unit tests of CI before a build, see
[Development](#development).

## Run

The units are started by the `docker-compose.yml` of mcloud (`stf app`, `stf auth-zebrunner`, `stf processor`, `stf storage-temp`, ...) and by `entrypoint.sh` of mcloud-device (`stf provider` for Android, `stf ios-device` for iOS). For development, `stf local` starts all the server units on one machine, `--auth-type zebrunner` uses the Zebrunner sign-in; its provider is the enrolled node `local` at `127.0.0.1`, which it enrolls with `stf node-add` after the migration (only enrolled nodes provide devices, see [Nodes (enrollment)](#nodes-enrollment)).

## Configuration

The variables the fork adds or the Zebrunner deployment relies on, the other options of every unit are listed by `stf <unit> --help`.

| Variable | Default | Description |
| --- | --- | --- |
| `SECRET` | | Secret of the session cookies and tokens: `--secret` of `app`, `auth-*`, `websocket` and, in the fork, of `storage-temp`/`storage-s3` |
| `RETHINKDB_ENV_AUTHKEY` | | Password of the `admin` of RethinkDB the units connect with (`./zebrunner.sh setup` of mcloud generates it); a new RethinkDB has no password, `stf migrate` sets it when the database has none yet (`lib/db/zebrunner-password.ts`) and stops when the database has another one. A change of the password is made in RethinkDB itself (`r.db('rethinkdb').table('users').get('admin').update({password: ...})`) |
| `STF_STORAGE_TOKEN` | | The token of the server units (`variables.env` of mcloud, `./zebrunner.sh setup` generates it): the triproxies and the storage units authenticate with it to the internal node routes of the API unit, the storage units accept it in `x-stf-internal-token`. It turns the protection of the storage on, the Zebrunner deployments must set it, see [Storage](#storage). Never given to a device host |
| `STF_NODES_API_URL` | | Base URL of the API unit (`http://stf-api:3000` in mcloud) for the triproxies and the storage units: the triproxies read the CURVE keys of the enrolled nodes from it, the storage units check node tokens with it. Needs `STF_STORAGE_TOKEN` |
| `STF_NODE_TOKEN` | | The node token of the enrolled node (`mcn1.<label>.<secret>`) for its device containers, required: the provider and the `ios-device` unit prove the registration of their devices with it and send it to the storage (`x-stf-internal-token`) |
| `STF_API_NODES_STF_URL`, `STF_API_NODES_CONNECT_SUB`, `STF_API_NODES_CONNECT_PUSH`, `STF_API_NODES_CONNECT_APP_DEALER`, `STF_API_NODES_CONNECT_DEV_DEALER` | `STF_URL` (the URL) | `--nodes-stf-url`, `--nodes-connect-*` of the API unit: what `POST /api/v1/nodes/enroll` gives a node, the public URL of STF and the triproxy endpoints the nodes reach (`tcp://<AGENTS_ADDRESS>:7250`, `:7270`, `:7160`, `:7260` in mcloud; a node uses the first two only, the triproxies refuse the keys of the nodes on the dealers). Without them the invites and enrollments fail (logged) |
| `STF_API_NODES_WG_ENDPOINT`, `STF_API_NODES_WG_PUBLIC_KEY`, `STF_API_NODES_WG_SERVER_ADDRESS`, `STF_API_NODES_WG_NETWORK` | | `--nodes-wg-endpoint` (`<host>:<port>`, the public UDP endpoint of the head), `--nodes-wg-public-key` (the WireGuard public key of the head), `--nodes-wg-server-address` (the WireGuard address of the head, a host of the network) and `--nodes-wg-network` (IPv4 CIDR, /8 to /30, e.g. `10.234.0.0/24`) of the API unit: the opt-in WireGuard tunnel of the nodes, see [WireGuard tunnel](#wireguard-tunnel). All of them or none: without them the tunnel is off and nothing changes, a part of them or an invalid one stops the unit at the start |
| `STF_STORAGE_TEMP_DOWNLOAD_ALLOW` | | Private network (CIDR or address) users may install apps from by URL, e.g. an artifact server; `--download-allow` can be repeated |
| `STF_FORWARD_ALLOW` | | Device units (provider): the networks (CIDR or address, separated by commas or spaces) the port forwards of the users may reach besides the public addresses, e.g. the LAN of the users. Without it a forward to a private, loopback, link-local or metadata address (checked again when connecting, also for host names) fails: a user cannot reach the services, the docker networks or the LAN of the node through it |
| `SSID` | `ssid` | Name of the session cookie of the app unit |
| `STF_SESSION_TTL_SECONDS` | `86400` | Lifetime of a session after the sign-in, see [Sessions](#sessions) |
| `STF_CONTACT_EMAIL` | | The sign-in units: the address of "Contact Support" of the UI (`GET /auth/contact`) for everyone, also before the sign-in, e.g. a support mailbox. Without it only a signed-in user gets an address, the email of the admin (the owner of the root group, never its name), see [Sessions](#sessions) |
| `ZEBRUNNER_LOGIN_URL` | | Login endpoint of Zebrunner IAM (`.../api/iam/v1/auth/login`), for `auth-zebrunner` |
| `ZEBRUNNER_USERINFO_URL` | | User endpoint of Zebrunner IAM (`.../api/iam/v1/users`), for `auth-zebrunner` |
| `STF_ADMIN_EMAIL`, `STF_ADMIN_NAME` | `administrator@fakedomain.com`, `administrator` | Owner of the root group and of the iOS devices |
| `STF_PROVIDER_DEVICE_NAME` | | Name of the device of the container, shown as its model |
| `STF_PROVIDER_HOST` | `127.0.0.1` | Host of the device container: the address of its enrolled node (the address of the invite), part of the node proof of its devices and the host of their screen URLs |
| `STF_PROVIDER_VNC_PORT` | `5900` | VNC port of the single device of a provider |
| `STF_PROVIDER_CONNECT_PORT` | | Fixed remote debug port (`adb connect`, `--connect-url-pattern`) of the Android device of a provider, 1..65535 for the provider; mcloud-device accepts 1024..65535 and passes it to Android only (the `--connect-port` of an iOS device is `MJPEG_PORT`), see [Ports of the Android devices](#ports-of-the-android-devices) |
| `STF_PROCESSOR_PUBLIC_IP` | `localhost` | Host of the screen URLs of iOS devices without a URL pattern |
| `STF_ZMQ_CURVE_SERVER_SECRET_KEY` | | Secret key of the triproxies: their tcp endpoints are CURVE servers that accept only the key of the server units (`STF_ZMQ_CURVE_SECRET_KEY`) and the keys of the active enrolled nodes (`STF_NODES_API_URL`), see [ZeroMQ](#zeromq) |
| `STF_ZMQ_CURVE_SERVER_PUBLIC_KEY` | | Public key of the triproxies: the units and the device providers connect to them over CURVE |
| `STF_ZMQ_CURVE_SECRET_KEY` | | Secret key of the client, with `STF_ZMQ_CURVE_SERVER_PUBLIC_KEY`; its public key is derived from it. The server units share one key (the triproxies accept it); a device host has its own one, registered by its enrollment |

`stf auth-zebrunner --app-url` is the address the sign-in sends the browser to with the token (`?jwt=...`), taken as is like the other `auth-*` units: mcloud gives `${STF_URL}/stf`, which stf-proxy rewrites to `/` of the app.

### Ports of the Android devices

`stf provider` gives every device worker a group of 4 ports of `--min-port`..`--max-port` (`STF_PROVIDER_MIN_PORT`, `STF_PROVIDER_MAX_PORT`): the first one is the screen WebSocket, the second one the remote debug port the users connect to (`adb connect`). With `--connect-port` (`STF_PROVIDER_CONNECT_PORT`, mcloud-device passes it) the remote debug port is fixed (`lib/util/zebrunner-connect-port.ts`):

- the port is taken out of the pool, the screen and the other ports never get it; the range needs 4 ports besides it (`7404`..`7410` with `7405`: the screen port is `7404`);
- one device worker holds it at a time, the first one started while it is free. mcloud runs one device per provider; another device started meanwhile gets the second port of its group, with a warning. The port is free again when its worker exits;
- an invalid port (not 1..65535) or a range without the 4 ports stops the provider at start; mcloud-device stops before, on a port below 1024.

Every Android device worker sends its ports to the processor (`DevicePortsMessage`) before it is ready, which stores them in the device document as `screenPort` and `connectPort`, as for the iOS devices. The REST API returns them (`GET /api/v1/devices?fields=serial,platform,present,display,screenPort,connectPort,provider`); the adb relay of mcloud reads `GET /api/v1/nodes/relay`, see [Nodes (enrollment)](#nodes-enrollment).

`stf ios-device` takes the options of a device unit plus `--wda-host` (`127.0.0.1` by default; mcloud-device passes `WDA_HOST`, the connector container), `--wda-port`, `--mjpeg-port`, `--device-name` and `--host`, see `stf ios-device --help`. Its `--connect-port` is the port of the MJPEG stream of WebDriverAgent (mcloud-device passes `MJPEG_PORT`), unless `--mjpeg-port` is given; the API returns it as the `connectPort` of the device.

### Cleanup between uses

With `--cleanup` (the default) a device is cleaned up when its user releases it (`lib/units/device/plugins/cleanup.ts`, `lib/units/ios-device/plugins/cleanup.ts`):

1. the apps installed since the first start of the unit in this container are uninstalled (adb, go-ios), but the ones of `--cleanup-keep-packages` (the helpers of the farm installed later: UiAutomator2, the settings of Appium, the agent of the MDM) and WebDriverAgent;
2. the state is reset, the steps of `--cleanup-reset` (`lib/util/zebrunner-reset.ts`), in this order. Each step is logged (`device:plugins:cleanup`), a failed one is logged and the next one runs; the cleanup never stops the unit.

| Step | Platform | Default | What it does |
| --- | --- | --- | --- |
| `proxy` | Android | on | a global HTTP proxy is turned off: `settings put global http_proxy :0` (Android applies it at once, a deleted key only at the next boot), then `http_proxy`, `global_http_proxy_host`, `_port`, `_exclusion_list` and `global_proxy_pac_url` are deleted. A farm whose devices need a global proxy leaves the step out |
| `dns` | Android | on | a Private DNS of a host name (`private_dns_mode=hostname`) goes back to the default of Android (`private_dns_mode`, `private_dns_specifier` deleted) |
| `accessibility` | Android | on | the accessibility services of the apps that are not of `--cleanup-keep-packages` are turned off (`enabled_accessibility_services`; `accessibility_enabled=0` when none is left); add the app of a service the farm needs to the keep list |
| `clipboard` | Android | on | the clipboard is emptied (STFService) |
| `wifi` | Android 11+ | on | the saved Wi-Fi networks that are neither of the first start (the same SSID and security: an open network of the name of the farm network is not it; Android 16 lists a network once per security type it takes, one of them is enough) nor of `--cleanup-keep-wifi` (SSIDs) are forgotten (`cmd wifi list-networks`, `forget-network`). Without the list at the start (Android 10 and older) none is forgotten. A network the MDM adds later goes to `--cleanup-keep-wifi` |
| `downloads` | Android | on | `/sdcard/Download` is emptied (only the number of the files is logged) |
| `media` | Android | off | `/sdcard/DCIM`, `Pictures`, `Movies`, `Music` and `Documents` are emptied too |
| `report` | Android | on | the device admins (but the ones of `--cleanup-keep-packages`) and the accounts (their types, never their names) added since the first start are logged as warnings: adb cannot remove them |
| `profiles` | iOS | on | the configuration profiles installed since the first start (`ios profile list`) are removed (`ios profile remove`), with the root certificates they installed and trusted; the profiles of the farm stay by their exact identifiers: the enrollment profile of mcloud-mdm (`com.zebrunner.mcloud.mdm`), its ready profiles (`com.zebrunner.mcloud.mdm.preset.*`, each by its name), the Wi-Fi profile of `zebrunner.sh mdm supervise` (`com.zebrunner.mcloud.wifi`), `com.apple.configurator.usbrestrictedmode` of `ios prepare`, and `--cleanup-keep-profiles` (a custom `MDM_PROFILE_ID` of mcloud-mdm, a profile the admin UI installs) |

| Option | Variable (provider) | Default | Description |
| --- | --- | --- | --- |
| `--cleanup-reset` | `STF_PROVIDER_CLEANUP_RESET` | every step but `media` | the steps, separated by spaces or commas; `none`: no step. One list for both platforms: a platform runs its steps of it |
| `--cleanup-keep-wifi` | `STF_PROVIDER_CLEANUP_KEEP_WIFI` | | Android: the SSIDs of the Wi-Fi networks that stay besides the ones of the first start, separated by commas |
| `--cleanup-keep-profiles` | | | iOS (`stf ios-device`): the identifiers of the profiles that stay besides the ones of the first start and of the farm, exact or a prefix ending with `*`, separated by spaces or commas |

The lists of the first start (the apps, the Wi-Fi networks, the device admins, the accounts, the profiles) are kept in `STF_CLEANUP_BASELINE_DIR` (the temp folder of the container by default) as `stf-cleanup-baseline-<serial>[-<kind>].json`: a restart of the unit (a reboot of the device, a crash) compares with them, not with what a user left; a new container starts new lists.

What the cleanup does not reset, and why:

| State | Why | What helps |
| --- | --- | --- |
| Android: the CA certificates a user installed | the shell of adb cannot read or write `/data/misc/user/0/cacerts-added` (checked on Android 12: Permission denied) | the device owner can: `DevicePolicyManager.uninstallAllUserCaCerts(admin)` in the agent of mcloud-mdm (a new push command, e.g. `mcloudResetCredentials`) and a node route of mcloud-mdm the unit calls on a release with its node token (`POST /android/cleanup?serial=<serial>` behind stf-proxy, as `/android/status`): follow-up, not implemented |
| Android: the accounts (Google, ...) | neither the shell nor the device owner can remove the account of another app; logged by `report` | the preset `accounts-off` of mcloud-mdm (`no_modify_accounts`) keeps users from adding them |
| Android: a device admin of an app | `dpm remove-active-admin` refuses an admin that is not test-only, and such an app cannot be uninstalled; logged by `report` | a factory reset |
| Android: the default apps (roles) | an uninstalled app loses its roles; a role given to an app that stays is kept (Android 12 `cmd role` cannot list them) | |
| Android: the proxy of a saved Wi-Fi network (the farm network) | a setting of the network, the shell cannot read or change it | the preset `wifi-locked` of mcloud-mdm (`no_config_wifi`) |
| iOS: the data of Safari, the pasteboard | no lockdown or MDM command clears them (the pasteboard: WebDriverAgent could, follow-up) | |
| iOS: whether `ios profile remove` removes a profile the user installed through Settings or one MDM installed | not checked on a device; a failure is logged and the profile stays | the preset `erase-off` of mcloud-mdm (`allowUIConfigurationProfileInstallation=false`) keeps users from installing profiles |

## REST API

| Route | What it does |
| --- | --- |
| `PUT /api/v1/devices/{serial}` with `{"status": ...}` or `{"device": {"status": ...}}` (the form mcloud-grid sends) | `disconnected`, `offline`, `available` (frees the device), `busy` (needs `owner.name`, also takes `owner.email`, marks the device as used by the owner), `unauthorized`, `preparing`, `unhealthy`, in any case; another status is refused with 400 |
| `GET /api/v1/devices/{serial}/size` | the display of the device, `{height: 0, width: 0, scale: 0}` when unknown |
| `GET /api/v1/devices/{serial}/owner` | the owner of the group of the device |
| `GET /api/v1/devices/{serial}/type` | the type of an iOS device as WebDriverAgent tells it, `{"type": "iPhone"}` (also an iPad) or `{"type": "Apple TV"}`; 404 for an unknown device or a device without a type (Android, or not read yet) |
| `POST /api/v1/user/devices/{serial}/keepalive` | the reservation of a device the user uses lasts its timeout from now: the timeout of a reservation counts the time without a message for the device, and an automation session sends none, so mcloud-grid keeps the devices of its sessions with it. The device gets the `GroupMessage` of its group again on its channel, which changes nothing but its last activity; `403` when the device is not the one of the user (another owner, absent, released; also for an admin), `504` when the device does not answer in 5 s |

The `size`, `owner`, `type` and `keepalive` routes need an access token (`Authorization: Bearer <token>`) as the other routes of the API.

The routes of the enrolled device hosts (`/api/v1/nodes/...`, `/api/v1/zebrunner/screen-auth`, `/api/v1/zebrunner/nodes/...`) are described in [Nodes (enrollment)](#nodes-enrollment), `GET /api/v1/zebrunner/hub-auth` in [Grid authentication](#grid-authentication).

The device lists and `GET /api/v1/devices/{serial}` also return `name`, the model of the device, and `screenPort` and `connectPort`, the ports of its worker (Android and iOS, see [Ports of the Android devices](#ports-of-the-android-devices)). The operations tagged `admin` need an admin with the session cookie of the app as with an access token (`lib/units/api/helpers/securityHandlers.ts`; upstream checked the token only).

The description of the API (`GET /api/v1/swagger.json`, and `/api-docs` of the unit) needs a signed-in user or an access token as the operations, 401 otherwise (upstream it was public): a client such as `swagger-client` sends the token with the request of the description. `GET /api/v1/users` lists every user to an admin only; another user gets itself and the users of its groups (the owners and members of the groups it owns or belongs to, the root group left out: it has every user), with `email`, `name` and `privilege` as before. The owner of a group adds another user by its email (`PUT /api/v1/groups/{id}/users/{email}`, the field "Add a user by email" of Settings > Groups > Users), the user is then a user of its groups; `PUT /api/v1/groups/{id}/users` without `emails` (every user) is refused to a user who is not an admin (400), it would list every user through the group (`lib/units/api/controllers/users.ts`, `groups.ts`).

### Access tokens

An access token (`Authorization: ******, the grid of mcloud, `STF_TOKEN`) is 64 hex characters, given once by its creation: `POST /api/v1/user/accessTokens` (`id` of the answer), `POST /api/v1/users/{email}/accessTokens` of an admin, Settings > Keys (the websocket event `user.keys.accessToken.generate`) and `stf token-add`. The database keeps its hash only: the document of the table `accessTokens` has the id `sha256:<hex sha256 of the token>`, the email of the user, the title, `createdAt` and `expiresAt`, and no JWT (upstream the id was the token itself, with a JWT of the user without an expiry, so a copy of the database or a backup gave every token). The API unit, the grid authorization (`hub-auth`) and the routes `GET`/`DELETE /api/v1/user/accessTokens/{id}` (the id is the token) hash the token they get and look the hash up (`lib/util/zebrunner-access-tokens.ts`, `lib/db/api.ts`). The lists of the tokens give the title and `expiresAt`, never the token or its hash.

| Setting | Default | Effect |
| --- | --- | --- |
| `ttl` of `POST /api/v1/user/accessTokens` and `POST /api/v1/users/{email}/accessTokens` (query, seconds, 60 to 315360000), "Expires in (days)" of Settings > Keys, `--ttl` of `stf token-add` | none | the token gets `expiresAt` (now + ttl) and is refused from then on (401, the grid too; the grid authorization keeps a user no longer than the expiry of the token); a ttl out of the bounds is refused (400). Without it the token does not expire, as before |

Upgrade: `stf migrate` (mcloud runs it before every start) replaces every earlier token by the document of its hash, without its JWT (`dbapi.hashAccessTokens`, logged as `Hashed <n> access tokens`); with `SECRET` in its environment (mcloud) only the tokens whose JWT it signed, a token of another `SECRET` (which did not work) is kept as it is and logged, so it does not start to work: the tokens of CI and `STF_TOKEN` of mcloud keep working, nothing changes for their users. Until it ran, a token that has no hash in the table is looked up as the id of an earlier document (never a token with the prefix `sha256:`) (taken with its JWT of `SECRET` as before, logged as a warning); after it, the table has hashes only, and neither the hash nor the hex part of a hash is a token. A migration that stopped between the hash and the removal of a document is finished by the next run. A token lost by its user cannot be shown again: remove it (Settings > Keys, `DELETE /api/v1/user/accessTokens`, which removes all the tokens of the user) and make a new one. An STF before this one does not find the hashed tokens: going back to it needs new tokens.

### Access token of the admin

`stf token-add [--email <email>] [--title <title>] [--ttl <seconds>]` creates an access token of a user directly in the database, without a sign-in, and prints it as `token=<token>`: `./zebrunner.sh start` of mcloud makes STF_TOKEN (the access token of the admin the grid, the node commands and adb-relay use) with it when STF_TOKEN is empty, after `stf migrate` (which creates the admin), also with the OAuth2 and LDAP sign-ins. The user is `STF_ADMIN_EMAIL` of the environment by default, the title is `mcloud`: an earlier token of the user with the title is replaced, the other tokens are kept (Settings, Keys). The database keeps the hash of the token (see [Access tokens](#access-tokens)); `--secret` (`SECRET`) is accepted and not used. The token does not expire unless `--ttl` is given. An unknown user exits with `1`.

## Grid authentication

stf-proxy of mcloud sends every request of the grid (`/mcloud`) through `auth_request` to `GET /api/v1/zebrunner/hub-auth?scope=<scope>` of the API unit, which answers 204 with the user in `X-MCloud-User` (the email), `X-MCloud-Admin` (`true` or `false`) and `X-MCloud-Token` (the access token of the request); stf-proxy passes them on to the grid, which reserves the devices of the sessions with the token of their user. The route has no authentication of the API unit, it checks the credential itself; stf-proxy does not let the users call it.

| Scope | For | Credential | Answer |
| --- | --- | --- | --- |
| `hub` (default) | the WebDriver hub, the Playwright sessions, the termination of a session | an access token of the user: `Authorization: Basic <any name>:<token>` (the user info of the hub URL of a test: `https://<user>:<token>@<host>/mcloud/wd/hub`, the name is not checked) or `Bearer <token>`; never the session cookie, a page of another site would start sessions with it | 204, 401 without a valid token |
| `console` | the console, the devices and the sessions of the grid | an access token or the session cookie | 204, 401 without a credential |
| `admin` | the other routes of the grid (the metrics, the API of the hub) | an access token or the session cookie of an admin | 204, 401 without a credential, 403 for a user |

An unknown scope is answered 400. The route answers for every WebDriver command, so it keeps the user of a token for 5 s and refuses an unknown token for 5 s without the database (by the sha256 of the token, up to 10000 tokens): a removed token (the websocket unit removes them too, the cache does not hear of it), a changed privilege or a new token take effect within 5 s. A token is never logged.

## Sessions

A sign-in starts a session in the database (`sessions` table, created by `stf migrate`, the `stf-migrate` service of mcloud); the session cookie of every unit that sets it (app, API, the sign-ins) is httpOnly and SameSite=Lax, and both it and the `XSRF-TOKEN` cookie (the double-submit token the UI reads, not httpOnly) are Secure when the public URL of the unit is https: `--auth-url` of the app, `--app-url` of the sign-ins, `--nodes-stf-url` (`STF_URL`) of the API, whatever the headers of the request say; otherwise for the https requests (`X-Forwarded-Proto: https` of the proxy that ends TLS, which can only add the flag), `lib/util/zebrunner-session.ts`. The app, storage and websocket units take the address of the client (`req.ip`, the logs, the sign-in record, the port forwards of the user) from `X-Forwarded-For` of one hop only and only from a peer of a private network (stf-proxy in the docker network): the address the proxy put last, never one the client wrote (upstream trusted every hop, and the websocket unit took the `uip` parameter of the URL the app gave the UI, which the fork no longer adds nor reads). `GET /auth/contact` of the sign-ins (the address of "Contact Support" of the UI) gives the email of the admin to a signed-in user only (an active session of the cookie of the app), nothing before the sign-in, or `STF_CONTACT_EMAIL` to everyone when it is set; upstream it gave the name and the email of the admin to anyone, `lib/util/zebrunner-contact.ts`. The app, API and websocket units drop a session that ended or is older than `STF_SESSION_TTL_SECONDS`, the users sign in again; the logout of the UI (`POST /app/api/v1/logout`) ends the session on the server. The Zebrunner, LDAP, OAuth2 and mock sign-ins hand the user to the app with a token that expires after two minutes (`lib/util/zebrunner-signin.ts`); the OAuth2 sign-in accepts only an email of `--oauth-domain` (`user@<domain>`) that the provider reports as verified, with the state parameter, see [OAuth2 sign-in](#oauth2-sign-in), and after five refused sign-ins of a user within three minutes they answer 429 for three minutes, doubled with every lock up to 30 minutes; the sign-in form tells the user to wait. See `lib/util/authsession.ts` and `lib/util/ratelimit.ts`.

### OAuth2 sign-in

`stf auth-oauth2` (`lib/units/auth/oauth2/`, `lib/util/zebrunner-signin.ts`) signs in the user of the email of the profile of the user info URL; the admin is the user with `STF_ADMIN_EMAIL`. The email is the identity of the user, so the provider must be the authority of the emails of `--oauth-domain`.

| Option (variable) | Default | Effect |
| --- | --- | --- |
| `--oauth-domain` (`OAUTH_DOMAIN`) | empty | only `user@<domain>` signs in (the exact domain, not a subdomain). Empty: every account of the provider with a verified email signs in, which the unit warns about at its start; set it for Google, Azure AD and every provider with accounts of other people |
| email verification | always | the profile must say the email is verified: `email_verified` `true` (or `"true"`, any case; OpenID Connect: Google `https://openidconnect.googleapis.com/v1/userinfo` or `https://www.googleapis.com/oauth2/v3/userinfo`, Keycloak, Okta, Auth0, GitLab), or `verified_email` `true` when there is no `email_verified` (the v1/v2 user info of Google). Upstream and earlier fork versions took a profile without the field, so a provider where a user sets an email of somebody else (e.g. of the admin) without it being verified let that user in as the other one |
| `--oauth-allow-missing-email-verified` (`OAUTH_ALLOW_MISSING_EMAIL_VERIFIED=true`) | `false` | also take a profile without `email_verified` and `verified_email`, for a provider that never sends them (`https://graph.microsoft.com/oidc/userinfo` of Azure AD / Entra ID, a generic OAuth2 user info): only with a provider where no user chooses an email it does not own (a single-tenant application of Azure AD, with `--oauth-domain`); the unit warns about it at its start. A profile with `email_verified` `false` is refused anyway |
| `--oauth-state` (`OAUTH_STATE`) | `true` | the authorization request has a random `state`, kept in the signed cookie `<ssid>-oauth2` of the sign-in (HttpOnly, SameSite=Lax, Secure for an https `--app-url`, 10 minutes, removed by the callback), not in the session cookie of the app; the callback with another state or without the cookie is refused (400, a page with a link to sign in again, logged), so a page of another site cannot sign a browser in as somebody else (login CSRF). Upstream it was off and could not work (no session store in the unit). `--no-oauth-state` (`OAUTH_STATE=false`) turns it off, for a provider that drops the parameter |

A refused callback (state, a denied consent, an unverified or other email) is logged with the reason and the email, never the code or the tokens. Google: authorization URL `https://accounts.google.com/o/oauth2/v2/auth`, token URL `https://oauth2.googleapis.com/token`, user info URL `https://openidconnect.googleapis.com/v1/userinfo`, scope `openid email`. A generic OpenID Connect provider: the `authorization_endpoint`, `token_endpoint` and `userinfo_endpoint` of its `/.well-known/openid-configuration`, scope `openid email`; it must give `email` and `email_verified` in the user info (Keycloak: the "Email verified" of the user).

## Storage

With `STF_STORAGE_TOKEN` set, `/s/upload`, `/s/download` and `/s/blob` of the storage units answer only:

- the device units of an active enrolled node, with `x-stf-internal-token: <node token>` (`STF_NODE_TOKEN` of the device container), checked with the API unit (`STF_NODES_API_URL`) and trusted for 30 s, see [Nodes (enrollment)](#nodes-enrollment);
- the server units, with `x-stf-internal-token: <STF_STORAGE_TOKEN>`;
- signed-in users, with the session cookie of the app unit.

The apk and image plugins forward the credentials of their caller, so `/s/apk/...` and `/s/image/...` are protected the same way. The device units download an app to install only from the storage (`storageauth.storageUrl`: `/s/...` of the origin of `--storage-url`), the href of the user cannot send the token elsewhere; the iOS unit runs go-ios and `xcrun` without a shell, launches only a valid bundle identifier and checks the answer of the storage. Scripts that use the storage without a session (e.g. with an access token of the API) are refused. `/s/download` (install from URL) downloads only from public addresses over http(s), checked after the DNS lookup, when connecting and on every redirect; `STF_STORAGE_TEMP_DOWNLOAD_ALLOW` lets private networks in.

Without the token the storage is open as in upstream (open routes, any download URL; `stf local`, the tests) and logs a warning at start. `--storage-token` needs `--secret` (`SECRET`), the secret of the session cookies of the app unit.

## ZeroMQ

The units and the device providers talk over ZeroMQ through the triproxies, which have no authentication in upstream: anyone who reaches their ports reads the events of all the devices and sends commands to them. With the `STF_ZMQ_CURVE_*` variables every tcp endpoint uses [CURVE](http://curvezmq.org) (`lib/util/zmqcurve.ts`, applied by `lib/util/zmqutil.ts` to every socket):

- the triproxies (the only units that bind) are CURVE servers with `STF_ZMQ_CURVE_SERVER_SECRET_KEY`; their ZAP handler accepts the key of the server units (the public key of `STF_ZMQ_CURVE_SECRET_KEY` of the triproxy) and, on the PUB and PULL sockets only (a node subscribes and pushes, nothing else), the keys of the active enrolled nodes; the DEALER sockets, which send to every device, accept the key of the server units only (a ZAP domain per kind: `stf-nodes`, `stf`). It reads the keys of the nodes from the API unit (`STF_NODES_API_URL`, with `STF_STORAGE_TOKEN`) every 5 s, keeping the last ones while the API unit does not answer; the keys of the revoked nodes and the retired keys of the nodes are refused (deny wins). It refuses the other keys, logging the address and the key once a minute. Until the first read of the keys (the start of the triproxy, the API unit not answering yet) it defers the other keys instead (ZAP 300, a temporary failure, logged once a minute too): libzmq ends such a connection at the handshake interval of the server (30 s) and the client connects again, so the nodes that connect right after a restart of MCloud are let in then, not refused for good. Without a running ZAP handler libzmq refuses every client (`ZMQ_ZAP_ENFORCE_DOMAIN`). A process runs one ZAP handler whatever the number of its CURVE sockets; a new set of keys never restarts it, and a start right after a stop waits until libzmq freed the endpoint of the old handler;
- the other units and the providers connect as CURVE clients of `STF_ZMQ_CURVE_SERVER_PUBLIC_KEY` with `STF_ZMQ_CURVE_SECRET_KEY`. A client whose key is refused logs `The ZeroMQ server <endpoint> refused the CURVE key <public key> of this host: it is not the key of an active enrolled node (enroll the node with this key, or it was revoked)` once a minute per endpoint (the monitor of the socket). libzmq does not connect a refused socket again, not even after the node is enrolled: the unit has to restart.

The keys are 64 hex characters: `stf curve-keygen` prints a new pair (`public=...`, `secret=...`), `stf curve-keygen --secret-key <key>` the pair of a secret key. A deployment has one server pair and a client pair for the server units; every device host has its own client pair, registered by its enrollment, see [Nodes (enrollment)](#nodes-enrollment): adding or revoking a node needs no restart. `./zebrunner.sh setup` of mcloud generates the keys of the server and of the server units. A unit with an incomplete or invalid configuration does not start. Without the variables the sockets have no security, as in upstream (`stf local`, the tests); CURVE is all or nothing for a triproxy, the clients without it cannot connect.

The device units find out that their messages do not reach the server from the registration: the processor acks the `DeviceIntroductionMessage` of the provider and the `DeviceReadyMessage` of the `ios-device` unit with a `DeviceRegisteredMessage`. Without the ack in 15 s the unit logs `No registration ack for "<serial>" in 15000 ms: the STF processor does not get the messages of this provider (unit). Check that the ZeroMQ server lets this host in: this node enrolled with the CURVE public key <public key> and active (not revoked), STF_ZMQ_CURVE_SERVER_PUBLIC_KEY the one of the server, the triproxy endpoints reachable.` (without CURVE: that the triproxy endpoints are reachable) and exits; the restart of its container is the retry. The provider counts a device as waiting from its discovery, so it no longer gives it up (`Providing all 0 of 1 device(s); ignoring ...`) while the registration is pending; a device that cannot be provided after its registration still makes it exit.

## Nodes (enrollment)

A device host ("node", [mcloud-agent](https://github.com/zebrunner/mcloud-agent)) joins with a one-time invite of an
admin and gets credentials of its own: a node token and its CURVE key, which the admin can revoke. Only enrolled nodes
provide devices. mcloud wraps the routes in `./zebrunner.sh node-invite` and `./zebrunner.sh nodes`, mcloud-agent in
`./zebrunner.sh join` and `./zebrunner.sh doctor`.

### Flow

1. An admin creates an invite for a label and the address of the node (`POST /api/v1/nodes/invites`). The address is
   the one the server connects to (`STF_PROVIDER_HOST` of the node): chosen by the admin, never by the node.
2. The node enrolls with the invite and its CURVE public key (`POST /api/v1/nodes/enroll`, no authentication, rate
   limited by stf-proxy) and gets its node token, the public key of the triproxies, the public URL of STF and the
   triproxy endpoints. The invite is used once.
3. The node gives its token to its containers: `STF_NODE_TOKEN` of the stf container (the node proof of the devices and
   the storage), the registration token of Appium in mcloud-grid.
4. The triproxies let the key of the node in within 5 s, the storage accepts its token, mcloud-grid verifies it
   (`POST /api/v1/nodes/verify`), its devices are bound to it (below).
5. Revocation (`POST /api/v1/nodes/{label}/revoke`) stops all of it; a new invite of the label re-enrolls the node with
   a new token and key (rotation).

`stf node-add --label <label> --address <host> [--public-key <key>]` enrolls a node directly in the database, without an
invite, for development and tests: `stf local` and the Compose test of CI use it for their provider (a loopback address
is accepted there). It takes the token from `STF_NODE_TOKEN`, or prints a new one as `token=<token>`.

### Identifiers and secrets

| What | Format | Kept by the server |
| --- | --- | --- |
| label | `^[a-z0-9][a-z0-9-]{0,39}$`, unique; `enroll`, `invites`, `relay`, `self` and `verify` are reserved (static paths of `/api/v1/nodes`) | `nodes.label` (primary key) |
| node token | `mcn1.<label>.<secret>`, 32 random bytes in base64url, shown once | `sha256(token)` hex only (`nodes.tokenHash`) |
| invite | `mci1.<secret>`, 32 random bytes in base64url, shown once; 60 minutes by default, at most 1440; single use; bound to the label and the address; a new invite of a label invalidates the unused ones of the label | `sha256(invite)` hex only (`node_invites.hash`) |
| address | an IPv4 address or a host name, lower case; no scheme, port, path or IPv6; not loopback (`127/8`, `localhost`), `0/8`, link-local or metadata (`169.254/16`, `metadata.google.internal`, ...), multicast or reserved (`224/3`); unique among the nodes. With the [WireGuard tunnel](#wireguard-tunnel): an IPv4 address of a host of its network, not the head | `nodes.address` |
| WireGuard key | only with the [WireGuard tunnel](#wireguard-tunnel): the public key of the node, base64 of 32 bytes (`wg pubkey`), `^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$`; unique among the nodes; public | `nodes.wgPublicKey` |

The tables are `nodes` {label, address, publicKey, tokenHash, status (`active`, `revoked`), createdAt, revokedAt,
lastSeenAt, generation (+1 on every re-enrollment), retiredKeys (the keys of the previous enrollments), wgPublicKey (only
with the WireGuard tunnel)} and
`node_invites` {hash, label, address, expiresAt, usedAt, createdBy, createdAt}, created by `stf migrate`
(`lib/db/tables.ts`); a device document gets `node`, `nodeGeneration` and `nodeClaim` (the node its last registration
claimed, valid or not, for the diagnostics).

### Routes

Every error is a generic `{"success": false}` (400: malformed or refused input, 401/403: refused credentials, 500: the
server), the reason is in the log of the API unit; no token or invite is ever logged. The admin routes take an
admin, with an access token (`Authorization: Bearer <token>`, the `STF_TOKEN` of mcloud) or the session cookie; the
security handler answers 401 without credentials and 403 to a user.

| Route | Who | Request | Answer |
| --- | --- | --- | --- |
| `POST /api/v1/nodes/invites` | admin | `{"label": "mac-mini-1", "address": "10.0.0.5", "ttlMinutes": 60}` | 201 `{"invite": "mci1....", "label": "mac-mini-1", "address": "10.0.0.5", "expiresAt": "2026-11-09T18:00:00.000Z"}` |
| `POST /api/v1/nodes/enroll` | anyone with an invite | `{"invite": "mci1....", "label": "mac-mini-1", "publicKey": "<64 hex>", "wgPublicKey": "<base64>"}` (`wgPublicKey`: [WireGuard tunnel](#wireguard-tunnel)) | 200 `{"nodeToken": "mcn1.mac-mini-1....", "label": "mac-mini-1", "address": "10.0.0.5", "serverPublicKey": "<64 hex>", "stfUrl": "https://mcloud.example.com", "endpoints": {"sub": "tcp://10.0.0.1:7250", "push": "tcp://10.0.0.1:7270", "appDealer": "tcp://10.0.0.1:7160", "devDealer": "tcp://10.0.0.1:7260"}}`, with the WireGuard tunnel also `"wireguard": {...}` |
| `GET /api/v1/nodes` | admin | | 200 `{"nodes": [{"label", "address", "publicKey", "wgPublicKey", "wireguard", "status", "createdAt", "revokedAt", "lastSeenAt"}]}`; `wgPublicKey` is the WireGuard key of the node or null, `wireguard` whether it has one |
| `POST /api/v1/nodes/{label}/revoke` | admin | | 200 `{"success": true}`; 400 for an unknown node |
| `DELETE /api/v1/nodes/{label}` | admin | | 200 `{"success": true}`; 400 for an unknown or active node |
| `GET /api/v1/nodes/self` | the node (`Authorization: Bearer <node token>`) | | 200 `{"label": "mac-mini-1", "address": "10.0.0.5", "status": "active", "lastSeenAt": "...", "devices": [{"serial": "R58M...", "platform": "Android", "present": true, "bound": true, "screenPort": 7404, "connectPort": 7405}]}`; the label also in the header `X-MCloud-Node`; 401 without a valid node token, 403 for a revoked node (below) |
| `PUT /api/v1/nodes/self/devices/{serial}` | the node (`Authorization: Bearer <node token>`) | `{"note": "...", "status": "Unhealthy"}`, either or both, also in `device` | 200 `{"success": true}`; 400 for any other field or status, 401 without a valid node token, 403 for a revoked node, 404 for a device not bound to the node ([Device status of a node](#device-status-of-a-node)) |
| `POST /api/v1/nodes/verify` | admin (mcloud-grid) | `{"token": "mcn1....", "host": "10.0.0.5"}` | 200 `{"label": "mac-mini-1", "address": "10.0.0.5"}` only for the token of an active node whose address is the host (case-insensitive), else 403; updates lastSeenAt at most once a minute |
| `GET /api/v1/nodes/relay` | admin (adb relay) | | 200 `{"devices": [{"serial": "R58M...", "label": "mac-mini-1", "address": "10.0.0.5", "connectPort": 7405}]}`: every Android device bound to an active node, present or not (the relay stays static, the node refuses the connections of an absent device); the address is the registered one of the node, never the display URL; the port is the connect port of the device |
| `GET /api/v1/zebrunner/screen-auth` | the user (session cookie or access token) | header `X-Original-URI: /d/<host>/<serial>/<port>/` | 204 with the screen ticket in `X-MCloud-Screen-Ticket`, or 401 without credentials, 403 otherwise (below) |
| `GET /api/v1/zebrunner/nodes/keys` | server units (`x-stf-internal-token: <STF_STORAGE_TOKEN>`) | | 200 `{"allowed": [<keys of the active nodes>], "denied": [<keys of the revoked nodes and the retired keys>]}` |
| `GET /api/v1/zebrunner/nodes/wireguard` | server units (`x-stf-internal-token: <STF_STORAGE_TOKEN>`) | | 200 `{"peers": [{"label": "mac-mini-1", "publicKey": "<WireGuard key of the node>", "address": "10.234.0.2"}]}`: the active nodes with a WireGuard key, the peers of the head ([WireGuard tunnel](#wireguard-tunnel)) |
| `POST /api/v1/zebrunner/nodes/token` | server units (`x-stf-internal-token: <STF_STORAGE_TOKEN>`) | `{"token": "mcn1...."}` | 200 `{"label": "mac-mini-1"}` for the token of an active node, else 403 |

The enrollment checks the shape of the request first (no database), then looks the invite up by its hash; only the
holder of a valid invite gets further. The invite is used by one atomic conditional update of RethinkDB (unused,
unexpired, of the label), so of concurrent enrollments with one invite exactly one succeeds. The key of another node
(current or retired) and the address of another node are refused before the invite is used. A re-enrollment of a label
replaces the address, the key and the token hash and increments the generation: the old token and key stop working at
once (the old key is kept in `retiredKeys`, refused by the triproxies). The invites and the enrollments of an API unit
run one at a time, which keeps the address and the key unique: mcloud runs one API unit.

### WireGuard tunnel

Opt-in (`NODES_WIREGUARD=true` of mcloud): the traffic between the head and its nodes (ZeroMQ, the grid, the screens,
the relay) goes through a WireGuard tunnel, the head and the nodes publish their ports on their WireGuard address only.
The devices to the MDM, the users to STF and the nodes to `STF_URL` stay on the public network. STF only enrolls the
nodes into it; mcloud runs the interface of the head (`mcloud`) and mcloud-agent the ones of the nodes. It is on when
the API unit has the four options `--nodes-wg-*` (`STF_API_NODES_WG_*`, [Configuration](#configuration)); without them
nothing of this applies and the routes answer as before (`wgPublicKey` of an enrollment is ignored and not stored).

- The address of a node is its WireGuard address: an invite takes only an IPv4 address of a host of
  `--nodes-wg-network`, neither its network nor broadcast address nor the head (400 otherwise), and the enrollment
  refuses an older invite of another address (403). mcloud allocates the addresses (`./zebrunner.sh node-invite`),
  the head is the first host of the network. All the checks of the address (the provider host, the screens, the relay,
  the grid) stay as they are.
- The enrollment needs `wgPublicKey` (403, logged `the head needs WireGuard: update mcloud-agent`, without a valid
  one), unique among the nodes of the other labels (403, like the CURVE key, the invite stays unused). It is stored in
  `nodes.wgPublicKey`; a re-enrollment replaces it (and one without the tunnel removes it). The answer has, besides the
  usual fields:
  `"wireguard": {"endpoint": "mcloud.example.com:51820", "publicKey": "<key of the head>", "serverAddress":
  "10.234.0.1", "address": "10.234.0.2", "network": "10.234.0.0/24", "persistentKeepalive": 25}`
  (`address` is the address of the node).
- The head reads its peers from `GET /api/v1/zebrunner/nodes/wireguard` (internal token, stf-proxy refuses
  `/api/v1/zebrunner/nodes*` from outside) or from `wgPublicKey` of the admin `GET /api/v1/nodes`: the active nodes
  with a WireGuard key, `AllowedIPs = <address>/32` each. A revoked node is left out, so the head drops it at once.

### Device binding

The provider and the `ios-device` unit read `STF_NODE_TOKEN` and send with the registration of a device (Android:
`DevicePortsMessage`, iOS: `InitializeIosDeviceState`) the label, the host of the provider (`--host`,
`STF_PROVIDER_HOST`) and `nodeProof` = hex HMAC-SHA256(key = the raw sha256 of the token,
`v1|<serial>|<providerHost>|<screenPort>|<connectPort>`) (`lib/util/zebrunner-nodes.ts`). The processor
(`lib/units/processor/zebrunner-nodes.ts`) binds the device (`node`, `nodeGeneration`) when the node is active, the
proof is valid with its token hash and the host is its address. Any other registration is rejected and logged (`Rejected
the registration of device "<serial>" from "<host>" (node "<label>"): <reason>`): the device gets no ports and no
binding and is not made ready (an `ios-device` unit gets no registration ack and exits). A device unit without
`STF_NODE_TOKEN` logs that its devices are rejected. A device is bound only while its node is active and has the
generation of the binding: revocation and rotation unbind the devices (screens and relay refused) until they register
again with the new token.

A device bound to another active node stays with it: a registration from any other node (or without a proof) is
refused and logged the same way, but neither takes the device nor clears its binding and ports. The device moves to
another node once its node is revoked or enrolled again, or once it has been absent for a minute (`REBIND_AFTER`,
unplugged there): the heartbeats of the real node make it present again, so a forged absence does not last that long.
A device unit refused meanwhile registers again on its restart (an `ios-device` unit exits without the ack).

### Screens

stf-proxy sends every connection to `/d/<host>/<serial>/<port>/` through `auth_request` to the API unit, e.g.:

```
location = /_screen_auth {
  internal;
  proxy_pass http://stf-api:3000/api/v1/zebrunner/screen-auth;
  proxy_pass_request_body off;
  proxy_set_header Content-Length "";
  proxy_set_header X-Original-URI $request_uri;
}
```

`GET /api/v1/zebrunner/screen-auth` answers 204 only if the user is signed in, the device of the serial exists and the
user uses it (or is an admin), the device is bound to an active node, the host is the address of that node and the
port is the screen port of the device.

With the 204 the API unit sends a screen ticket in `X-MCloud-Screen-Ticket`, which stf-proxy passes to the node:

```
location ~ ^/d/... {
  auth_request /_screen_auth;
  auth_request_set $screen_ticket $upstream_http_x_mcloud_screen_ticket;
  proxy_set_header X-MCloud-Screen-Ticket $screen_ticket;
  ...
}
```

The ticket is `v1.<expiry, unix seconds>.<hex HMAC-SHA256(key = raw sha256(node token), screen|v1|<serial>|<port>|<expiry>)>`
and is valid for 60 seconds (`lib/util/zebrunner-nodes.ts`). The screen WebSocket of the device units (`device` and
`ios-device`) takes a connection only with a valid ticket for its serial and screen port, checked with its
`STF_NODE_TOKEN`, or from the loopback of its container (the broadcast of the screen of mcloud-device); any other
host of the network of the node gets 401, and without `STF_NODE_TOKEN` only the loopback is taken. The ticket is
checked once, when the socket opens: the device units close every screen socket but the loopback ones when the user
leaves the device (release, timeout, kick), so a screen never outlives the use it was opened for. stf-proxy has to
pass the ticket before the device units check it: update the head before the nodes.

A standalone STF whose browsers open the screen ports of the provider themselves, with no proxy to pass a ticket
(`docker-compose.yaml`), sets `STF_SCREEN_WITHOUT_TICKET=true` for the provider: its screens are open to any host that
reaches the screen ports, as in DeviceFarmer STF, so keep these ports off untrusted networks. Never for MCloud.

### Device status of a node

`PUT /api/v1/nodes/self/devices/{serial}` lets a node, with its own token, mark a device bound to it `Unhealthy` and
set its note (cut at 2000 characters): Appium of mcloud-agent does it on the errors of the device its next sessions
would get too (no space left), with the node token of its container (`NODE_REGISTRATION_TOKEN`). Nothing else: no
other status, no owner, no device of another node, so the nodes need no access token of an admin of STF.

### Diagnostics

`GET /api/v1/nodes/self` answers a node, with its own token, what STF knows of it: the node (label, address, status,
the last time mcloud-grid verified it) and its devices, the ones bound to it and the ones whose last registration
claimed it, each with `present`, `bound` (bound to the node with its current token) and its ports. A device that
`bound: false` names was rejected: the log of the processor tells why (`Rejected the registration of device ...`). A
deployed device missing from the list never registered: its container does not reach the triproxies (the CURVE key of
the node, `STF_ZMQ_CURVE_SERVER_PUBLIC_KEY`, the endpoints). `./zebrunner.sh doctor` of mcloud-agent calls it,
`./zebrunner.sh nodes check <label>` of mcloud shows the same from the server side.

The label of the node is in the header `X-MCloud-Node` of the answer too: stf-proxy of mcloud checks the node token of
the MDM paths of the nodes (`/mdm/enroll`, `/android/release`, ...) with this route (`auth_request`) and passes the
label to mcloud-mdm in that header (the one of the client overwritten); with `MDM_ENFORCE_NODE_BINDING=true` of mcloud,
mcloud-mdm acts only on the devices whose `node` is that label. An older STF sends no header: mcloud-mdm then refuses
every MDM call of the nodes while the setting is on.

| What is wrong | What STF tells |
| --- | --- |
| The token is not the current one (rotated, mistyped) | `GET /nodes/self` 401; the devices rejected (`invalid node proof`) |
| The node was revoked | `GET /nodes/self` 403; the triproxies refuse its key, the devices are rejected (`revoked node`) |
| `STF_PROVIDER_HOST` is not the address of the invite | the devices rejected (`the host of the provider (STF_PROVIDER_HOST) is not the address of the node`) |
| The containers have no `STF_NODE_TOKEN` | the device units log it; the devices rejected (`no node proof`) |
| The key of the node is not the enrolled one | the device units log `The ZeroMQ server ... refused the CURVE key ...`; no device registers |
| The server does not reach `<address>:<screenPort>` | the screens fail although the devices are bound; check the address of the invite and the firewall of the node |

### Node and server on one machine

A node may run on the machine of the server. The address of its invite is then the LAN address of the machine (a
loopback address, `0.0.0.0` or `localhost` is refused), mcloud joins and serves on that address too (its
`AGENTS_ADDRESS`), and the device containers reach the published ports of the triproxies (7160, 7250, 7260, 7270), the
grid (4446) and stf-proxy (`STF_PORT`) on it. The ports of the devices must not be ports of the server (`STF_PORT`,
4446, 7160, 7250, 7260, 7270, the adb relay); `./zebrunner.sh doctor` of mcloud-agent checks it.

### Security properties

- Only hashes of tokens and invites are stored; they are compared through their sha256 in constant time and never
  logged. The node token is shown once.
- An invite is single use, short lived, bound to a label and an address the admin chose; the node cannot choose where
  the server connects to.
- Errors are generic, so the enrollment is no oracle; a malformed enrollment costs no database access, an unknown
  invite one primary key lookup (stf-proxy rate limits the route).
- Every node has its own token and CURVE key, revoked on its own without a restart: the triproxies refuse the key of a
  revoked node within 5 s, the storage refuses its token within 30 s, mcloud-grid within its verification interval,
  its devices lose their binding at once.
- No device without a node: a registration without a valid node proof is rejected, the screens and the relay only
  serve devices bound to an active node.
- The triproxies and the storage units get no database access: they ask the API unit, authenticated with the token of
  the server units, which only answers public keys and yes/no; the token hashes never leave the API unit (they are the
  keys of the node proofs).
- The relay and the screens use the registered address of a node, never what a device reports.

### Residual risks

- Existing ZeroMQ sessions of a revoked node survive until the triproxies restart: ZAP checks new connections only.
  `./zebrunner.sh nodes revoke` of mcloud restarts them.
- A compromised active node can still lie about its own devices (their state, screens and ports on its own address);
  it cannot bind devices to another node or address, nor take or clear the binding of a device of another active
  node. The other messages of a device (ready, presence, status, remote connect) carry no proof of the node yet.
- The LAN traffic to the grid (Appium of the nodes) is plain HTTP: a node token can be sniffed there, but it is bound
  to the address of its node for the grid, the device binding and the relay. The opt-in
  [WireGuard tunnel](#wireguard-tunnel) encrypts it.
- The uniqueness of the address and key is kept by the API unit serializing the enrollments: several API units could
  race on two different invites with the same address (one invite is still used once).
- A processor makes ready only the devices whose last registration it bound, or whose binding the database has: with
  several processors (`stf local` runs two) the registration and the ready message of a device can reach different
  ones, the second one waits up to 10 s for the binding the first one writes.
- A host name address can resolve to a forbidden address; only the literal is checked.

## Development

| Command | What it checks |
| --- | --- |
| `make check` | `make lint` and `make test`, every one of them, as CI; fails when one failed |
| `make lint` | the lint of CI: `npm run lint` and the shell of the `run:` blocks of the workflows (`.github/scripts/check-run-blocks.mts`) |
| `make test` | the unit tests of CI: `npm run test:unit` |
| `node build.mts compile` | compiles `lib/` (the tests and `stf` run the compiled files) |
| `npm run lint` | eslint, type checks, JSON and the translation template |
| `npm run test:unit` | the mocha tests of `test/`, the fork ones are in `test/units/zebrunner/` |
| `npm run test:component` | the vitest tests of the UI, the fork ones are `*.zebrunner.test.ts` and `device-list/zebrunner.test.ts` |

The `make` targets are thin wrappers over the npm scripts. They run `npm ci` first when `node_modules` is missing or older than `package-lock.json` (the stamp is `node_modules/.package-lock.json`, the hidden lock file npm writes); the `prepare` script of `npm ci` builds `lib/` and the UI.

### CI

[![Nightly CI](https://github.com/zebrunner/stf/actions/workflows/ci.yml/badge.svg?event=schedule)](https://github.com/zebrunner/stf/actions/workflows/ci.yml?query=event%3Aschedule)

- CI runs on PRs and pushes to `develop`/`master`, not for a change of documentation only (`**.md`, `doc/**`, `LICENSE`, `.github/ISSUE_TEMPLATE/**`). Build, lint, unit, component, integration and Compose run on every one of them; the device legs (Android emulators, iOS simulators) depend on the event:

  | Event | Android legs | iOS legs |
  | --- | --- | --- |
  | pull request | `quick` | `quick`, only when the PR changes a file of `ios.paths` of `.github/zebrunner-ci.json` (the `ios-device` unit and CLI, the WDA test client, the iOS CI files) or has the label `ci:ios` |
  | push to `develop`/`master` | none | none |
  | nightly (`schedule`, 02:30 UTC, on `develop`; GitHub starts it about 8 to 10 hours later) | `full` | `full` |
  | `workflow_dispatch` | the `matrix-profile` input | the `matrix-profile` input |

  So a merge into `develop` gets its image from the `Publish` job as soon as the other jobs passed, without waiting for the device legs; the nightly run tests what was merged during the day on every version. The dependency updates (`package.json`, `package-lock.json`) are not in `ios.paths`: the nightly run tests them with iOS, the label `ci:ios` before the merge. Adding the label `ci:ios` runs the last CI run of the PR again (`.github/workflows/zebrunner-ci-ios-label.yml`, which cancels it first when it still runs), whose `Plan` job reads the labels and plans the iOS legs; the other labels run nothing. The report of a run says which device legs did not run and why.
- When the hosted macOS runners are short, GitHub cancels a queued iOS leg after about 15 minutes ("The job was not acquired by Runner of type hosted even after multiple attempts"): the leg has no runner, no step and no verdict, and `Report` fails the run. `.github/workflows/zebrunner-ci-ios-rerun.yml` (on `workflow_run` of CI, the file of `develop`) then runs the failed and cancelled jobs of the run again (`gh run rerun --failed`, the not acquired legs and `Report`; the other jobs keep their results and verdicts), up to the third attempt of the run, for pull requests, nightly and manual runs alike. `.github/scripts/zebrunner-ios-rerun.mts` decides: not a run that did not fail (a cancelled one), not a run with a newer run of the same event and branch (the rerun would cancel it), and not a run in which a job that ran failed (a real failure is not hidden by a rerun; a person reruns it), the optional iOS legs and `Report` aside. The summary of its job says why it did or did not run the run again.
- A failing nightly run fails the workflow run, so GitHub notifies it like any failed run (to the user who last changed the `cron` of `ci.yml`, see the GitHub docs on the notifications of scheduled workflows); its report is the summary of the `Report` job, the badge above shows the last one. GitHub disables a schedule after 60 days without any activity in the repository.
- Android starts at Android 12 (API 31): `.github/zebrunner-ci.json` sets the lowest API level; `.github/android-matrix.json` stays the upstream file. `.github/scripts/zebrunner-ci.mts` selects the same coverage for the job matrices and the report.
- The `quick` profile tests the newest stable revision of each of the two newest OS majors, and the oldest supported Android: currently Android API 31, 36.1 and 37.1, and iOS 26 and 27. The oldest iOS (15), the intermediate versions, the optional iOS legs (none now) and the non-stable Android SDK channels are full-only.
- Run all configured versions manually with `gh workflow run ci.yml --ref develop -f matrix-profile=full` (or Actions > CI > Run workflow > `full`). The report states the profile, identifies untested versions and treats missing verdicts within the selected profile as failures.
- `.github/workflows/zebrunner-ios.yml` tests the WDA client of the `ios-device` unit against WebDriverAgent on iOS simulators: iOS 15 (runtime from `xcodes`), 16, 17 (runtimes downloaded for Xcode 16.4), 18, 26 and 27 (the `xcode-27` preview image); the full matrix is `ios.include` of `.github/zebrunner-ci.json`. `ci.yml` passes its profile and the matrix of its `Plan` job to this workflow; a standalone manual iOS run (`gh workflow run zebrunner-ios.yml`) plans the matrix itself and defaults to `full`. Tests start from a fresh session and the home screen rather than depending on previous test state. CI allows two retries per Playwright/iOS test; recovered failures are explicitly reported as flaky. WDA startup already has three attempts and Android has two whole-leg attempts; increasing those would only lengthen deterministic failures. A leg can be marked `optional` (with the reason and what makes it required again) in `.github/zebrunner-ci.json`: the report shows its failure as a warning and does not count it. iOS 27 was optional while the iOS 27.1 runtime of the `xcode-27` image had the iPhone Duo only, on which XCTest failed to start WebDriverAgent (#1083); it is required again since the image got the iOS 27.2 runtime with all the iPhones. Locally, on a Mac with Xcode:

  ```bash
  node build.mts compile
  bash .github/scripts/zebrunner-ios-simulator.sh 27
  IOS_VERSION=27 npx mocha --exit --extension mts test/zebrunner-ios
  ```
- The iOS legs do not build WebDriverAgent: `.github/scripts/zebrunner-ios-simulator.sh` downloads `WebDriverAgentRunner-Build-Sim-<arch>.zip` of the appium/WebDriverAgent release `WDA_REF` (`zebrunner-ios.yml`) while the simulator boots, checked by the sha256 the script has for that release (a new `WDA_REF` needs its sums).

### Keeping up with upstream

The fork merges [DeviceFarmer/stf](https://github.com/DeviceFarmer/stf) `master` (remote `upstream`) regularly, so its changes are kept where a merge does not reach them:

- fork code goes to new files (`zebrunner` in the name, or `lib/units/ios-device/`); an upstream file only gets the lines that call it, marked with a `Fork (Zebrunner)` comment;
- fork tests go to `test/units/zebrunner/` and `*.zebrunner.test.ts`, the runners find them without a configuration change;
- a new wire message takes a free code above the upstream ones and is pinned in `test/wire/protobuf.mts`; a retired code is added to `reserved`;
- `res/common/lang/po/stf.pot`: add and remove the fork messages only, do not commit a fully regenerated file (the translation check compares the messages, not the source references);
- `api_v1_generated.json` stays the upstream file, the API unit reads `api_v1.yaml`;
- `package-lock.json` and `test/playwright/package-lock.json` are committed (upstream ignores them): the image and CI install them with `npm ci`. After a merge that changes `package.json`, `npm install` updates the lock file, commit it with the merge; `npm audit` should stay clean, `overrides` in `package.json` pins the fixed versions of nested dependencies (`resolutions` is the same for yarn, kept as upstream has it; npm ignores it);
- `@types/node` follows the major of the Node.js of `.nvmrc` and of the image (22), so the type check refuses APIs of newer versions: keep it at a merge (upstream may have a newer one); dependabot proposes no major update of it;
- Dependabot proposes the npm updates weekly: the minor and patch updates of every package in one pull request, each major update in its own (the `@mantine/*` packages together);
- no editor settings, generated files or permission changes.

A sync: `git fetch upstream && git merge upstream/master`, `npm install` when `package.json` changed, then `make check` and `npm run test:component`.

### Conventions

The repository follows [mcloud-conventions](https://github.com/zebrunner/mcloud-conventions) where they do not touch upstream files: [Conventional Commits](https://www.conventionalcommits.org/), `kebab-case` branch names, pull requests into `develop`, ASCII-only documentation. The `Makefile` has the targets of the conventions (`help`, `check`, `lint`, `test`, then `build` and `push`) over the npm scripts, without `docker`: the image has no tests of its own. It is not synced by mcloud-conventions: `LICENSE`, `.editorconfig`, `.gitignore` and the lint setup belong to upstream and the shell checks do not apply to a Node.js project.

## Support

[Zebrunner](https://zebrunner.com), the issues of [zebrunner/stf](https://github.com/zebrunner/stf/issues).

## License

[Apache License 2.0](LICENSE)
