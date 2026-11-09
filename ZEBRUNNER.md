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
| Authentication of the storage routes and SSRF protection of downloads | `lib/util/storageauth.ts`, `lib/util/urlsafety.ts` |
| Enrolled device hosts ("nodes"): one-time invites, per-node tokens, revocation, the CURVE keys of the nodes in the ZAP handler of the triproxies, node tokens in the storage, the node binding of the devices, the screen authorization of stf-proxy and the devices of the adb relay, see [Nodes (enrollment)](#nodes-enrollment) | `lib/util/zebrunner-nodes*.ts`, `lib/db/zebrunner-nodes.ts`, `lib/units/api/controllers/zebrunner-nodes.ts`, `lib/units/processor/zebrunner-nodes.ts` |
| One provider per device container: fixed VNC port, fixed connect port (`STF_PROVIDER_CONNECT_PORT`), `UNHEALTHY` and exit when the device cannot be provided or the processor does not ack its registration, see [ZeroMQ](#zeromq) | `lib/cli/provider/`, `lib/units/provider/` |
| `.ipa` manifests (Info.plist) in the apk storage plugin | `lib/units/storage/plugins/apk/task/` |
| The WebSocket sends the commands of a user (input, shell, install, remote ADB, files, ...) to the devices the user uses only (an admin: to any device), the invitations to the devices of the groups of the user, and subscribes the client to the channels of its transactions only: the channel of a device is `base64(sha1(serial))`, so any user controlled any device. A released device gets no command later than 2 s after it | `lib/units/websocket/zebrunner-channels.ts`, `lib/db/zebrunner.ts` |
| A malformed ZeroMQ message or WebSocket event (or a listener failing on it) is logged once a minute and dropped instead of ending the unit: the listeners run in `process.nextTick`, so their exceptions were uncaught | `lib/util/zebrunner-guard.ts`, `lib/wire/router.ts`, `lib/units/websocket/index.ts` |
| UI: iOS/tvOS controls, the app under `/stf`, device list filter and scroll position | `res/app/src/` (`zebrunner` in the file name, or marked `Fork (Zebrunner)`) |
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
| Gestures (screen) | the UI records the path of every finger with its timing (Alt with the mouse adds the mirrored finger of a pinch) and draws its trail over the screen; when the gesture ends it goes to the unit as `TouchPathIosMessage` and WDA replays it as W3C actions on at most 6 ticks of the path, since WDA spends ~0.25 s on every move (`wda/gesture.ts`, `res/app/src/features/control/screen/ios-gesture.ts`); a click stays a tap or a long press | iOS takes no live touches without a jailbreak, so the device gets the gesture once it ends; no gestures on tvOS |
| Back and Recents (menu of the screen) | Back taps the back button of the navigation bar of the app in front (the first button of a navigation bar, on the left third of the screen), else the "◀ <app>" breadcrumb of the status bar (looked for in SpringBoard) to the app that opened this one, else does nothing; Recents swipes up from the bottom edge and holds at 78% of the height, or presses Home twice on an iPhone with the Home button (`wda/navigation.ts`); a button WDA has not is logged instead of stopping the unit | no Back in an app without a navigation bar (a swipe from the edge could do something else there); Recents on Apple TV is not supported, Back is Menu |
| Speed of taps and gestures | a WDA session STF creates (no Appium test runs) gets `snapshotMaxDepth=1`, `waitForIdleTimeout=0`, `animationCoolOffTimeout=0`: WDA snapshots the app for every move of `/actions`, a tap takes 0.4 s instead of 1.4 s (`wda/fast-input.ts`); the automations that look for elements run with the defaults, which come back when the session ends | a session of Appium keeps its own settings (WDA resets them in every new session), so the screen of a running test keeps the slower taps |
| Clipboard (Dashboard) | WDA reads and writes the pasteboard with its runner in front for a moment (iOS 16+ gives the pasteboard to the app in front only), then the app that was in front comes back; paste also types the text into the focused field, like Android (`clipboard.ts`, `wda/pasteboard.ts`) | about 2-3 seconds; WDA accepts the "Allow Paste" alert itself |
| Apps (Dashboard) | Settings, its Wi-Fi page, General > iPhone Storage (Manage Apps) and Developer, opened through WDA (`radio.ts`, `wda/settings.ts`) | only Settings and the App Store on tvOS |
| Info | hardware, iOS build, CPU architecture, SIM, storage and battery (temperature, voltage, health) from lockdown through `ios info`, `ios diskspace` and `ios batteryregistry` (`info/index.ts`, the battery every 5 minutes); marketing name, release date, CPU, RAM, screen size, ppi and refresh rate of the model by its ProductType (`lib/util/zebrunner-ios-models.json`, 133 iPhone and iPad models up to October 2026, from Wikipedia and Apple; add the new models there) | RAM is the smallest of a model; Airplane Mode is read from the root page of Settings whenever the unit opens Settings (Wi-Fi, Bluetooth, the Apps shortcuts), iOS logs it only when it changes; roaming and the cellular technology are not known |
| Network (Info) | the system log through `ios ostrace` (no tunnel) for up to 15 seconds every 5 minutes: the primary interface (`symptomsd`) and the Wi-Fi link, SSID, RSSI, SNR, channel and bandwidth (`wifid`); `IosNetworkEvent` | the log costs the device some CPU while it is read |

There is no port forwarding (iOS cannot run the reverse proxy of Android), no remote debug, ringer mode or bonded Bluetooth devices. go-ios reaches the device through usbmuxd (`USBMUXD_SOCKET_ADDRESS` of mcloud-device). The developer services of iOS 17+ (`ps`, `launch`, `kill`, `info display`, `devicestate`, ...) need a tunnel: the unit runs none, go-ios uses the userspace tunnel the connector container (mcloud-ios-connector) shares for iOS newer than 17.4.0 (`GO_IOS_AGENT_HOST=connector` of mcloud-device, the tunnel API on port 60105). iOS 17.0-17.4.0 has no shared tunnel, so these commands fail there, and a device with `WIRELESS=true` has no go-ios features at all.

The type of the device (iPhone or Apple TV), its screen and its iOS version come from WebDriverAgent without a session when the unit starts (`devicestate.ts`, read again on the next join while WDA fails): the unit sends them to the processor (`IosDeviceScreenMessage`, `SdkIosVersion`), which stores them for the API, the grid and the UI. The device units (`ios-device`, and `device` of Android) have no database: only the units of the server connect to RethinkDB, the device containers get no address of it.

## Image contents

| Component | Why |
| --- | --- |
| Ubuntu 26.04, STF with the fork, Node.js 22 | the STF units; the build tools stay in the build stage |
| bundletool 1.18.3, OpenJDK 21 (JRE) | converts the uploaded `.aab` files into `.apk` files (storage-temp) |
| GraphicsMagick, TurboJPEG | resize the images and the screenshots (storage-plugin-image) |
| `libplist-utils` (`plistutil`) | reads the binary `Info.plist` of uploaded `.ipa` files |
| iOS, Android and tvOS icons | replace the generic icons of `@devicefarmer/stf-device-db` |

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
which takes long for the native modules: building every platform on its own machine and joining them with
`docker buildx imagetools create` (as `.github/workflows/docker-build.yml`) is faster.

Without docker (Node.js 22.18 or later):

```bash
npm ci
node build.mts build
```

`make help` lists the targets; `make check` runs the lint and the unit tests of CI before a build, see
[Development](#development).

## Run

The units are started by the `docker-compose.yml` of mcloud (`stf app`, `stf auth-zebrunner`, `stf processor`, `stf storage-temp`, ...) and by `start_all.sh` of mcloud-device (`stf provider` for Android, `node /app/lib/cli ios-device` for iOS). For development, `stf local` starts all the server units on one machine, `--auth-type zebrunner` uses the Zebrunner sign-in.

## Configuration

The variables the fork adds or the Zebrunner deployment relies on, the other options of every unit are listed by `stf <unit> --help`.

| Variable | Default | Description |
| --- | --- | --- |
| `SECRET` | | Secret of the session cookies and tokens: `--secret` of `app`, `auth-*`, `websocket` and, in the fork, of `storage-temp`/`storage-s3` |
| `RETHINKDB_ENV_AUTHKEY` | | Password of the `admin` of RethinkDB the units connect with (`./zebrunner.sh setup` of mcloud generates it); a new RethinkDB has no password, `stf migrate` sets it when the database has none yet (`lib/db/zebrunner-password.ts`) and stops when the database has another one. A change of the password is made in RethinkDB itself (`r.db('rethinkdb').table('users').get('admin').update({password: ...})`) |
| `STF_STORAGE_TOKEN` | | Token the STF units send to the storage (`x-stf-internal-token`); set for `storage-temp`/`storage-s3` (`variables.env` of mcloud, `./zebrunner.sh setup` generates it) and, the same value, for the device containers of a legacy node (an enrolled node sends its node token instead). It turns the protection of the storage on, the Zebrunner deployments must set it, see [Storage](#storage). It is also the token of the server units for the internal node routes of the API unit, see [Nodes (enrollment)](#nodes-enrollment) |
| `STF_NODES_API_URL` | | Base URL of the API unit (`http://stf-api:3000` in mcloud) for the units without a database: the triproxies read the CURVE keys of the enrolled nodes from it, the storage units check node tokens with it. Needs `STF_STORAGE_TOKEN`; without it the enrolled nodes are not known to them |
| `STF_NODE_TOKEN` | | The node token of an enrolled node (`mcn1.<label>.<secret>`) for its device containers: the provider and the `ios-device` unit prove the registration of their devices with it |
| `AGENT_HOSTS` | | For the API unit: the legacy (not enrolled) device hosts whose screens `GET /api/v1/zebrunner/screen-auth` lets through for unbound devices, separated by commas or spaces |
| `STF_API_NODES_STF_URL`, `STF_API_NODES_CONNECT_SUB`, `STF_API_NODES_CONNECT_PUSH`, `STF_API_NODES_CONNECT_APP_DEALER`, `STF_API_NODES_CONNECT_DEV_DEALER` | `STF_URL` (the URL) | `--nodes-stf-url`, `--nodes-connect-*` of the API unit: what `POST /api/v1/nodes/enroll` gives a node, the public URL of STF and the triproxy endpoints the nodes reach (`tcp://<AGENTS_ADDRESS>:7250`, `:7270`, `:7160`, `:7260` in mcloud). Without them the invites and enrollments fail (logged) |
| `STF_STORAGE_TEMP_DOWNLOAD_ALLOW` | | Private network (CIDR or address) users may install apps from by URL, e.g. an artifact server; `--download-allow` can be repeated |
| `SSID` | `ssid` | Name of the session cookie of the app unit |
| `STF_SESSION_TTL_SECONDS` | `86400` | Lifetime of a session after the sign-in, see [Sessions](#sessions) |
| `ZEBRUNNER_LOGIN_URL` | | Login endpoint of Zebrunner IAM (`.../api/iam/v1/auth/login`), for `auth-zebrunner` |
| `ZEBRUNNER_USERINFO_URL` | | User endpoint of Zebrunner IAM (`.../api/iam/v1/users`), for `auth-zebrunner` |
| `STF_ADMIN_EMAIL`, `STF_ADMIN_NAME` | `administrator@fakedomain.com`, `administrator` | Owner of the root group and of the iOS devices |
| `STF_PROVIDER_DEVICE_NAME` | | Name of the device of the container, shown as its model |
| `STF_PROVIDER_HOST` | `127.0.0.1` | Host of the device container; declared because the containers set it (the CLI is strict) |
| `STF_PROVIDER_VNC_PORT` | `5900` | VNC port of the single device of a provider |
| `STF_PROVIDER_CONNECT_PORT` | | Fixed remote debug port (`adb connect`, `--connect-url-pattern`) of the device of a provider, 1..65535, see [Ports of the Android devices](#ports-of-the-android-devices) |
| `STF_PROCESSOR_PUBLIC_IP` | `localhost` | Host of the screen URLs of iOS devices without a URL pattern |
| `STF_ZMQ_CURVE_SERVER_SECRET_KEY` | | Secret key of the triproxies: their tcp endpoints are CURVE servers that accept only the clients of `STF_ZMQ_CURVE_CLIENT_KEY_<HOST>` and `STF_ZMQ_CURVE_CLIENT_KEYS`, see [ZeroMQ](#zeromq) |
| `STF_ZMQ_CURVE_CLIENT_KEY_<HOST>` | | Public key of one client the triproxies accept (a device host), one key per variable; `<HOST>` (`[A-Za-z0-9_]+`) is a free label of the host, an empty variable is ignored |
| `STF_ZMQ_CURVE_CLIENT_KEYS` | | Public keys of the clients the triproxies accept (the device hosts), separated by commas or spaces; added to the ones of `STF_ZMQ_CURVE_CLIENT_KEY_<HOST>`, the key of `STF_ZMQ_CURVE_SECRET_KEY` of the triproxy is accepted too |
| `STF_ZMQ_CURVE_SERVER_PUBLIC_KEY` | | Public key of the triproxies: the units and the device providers connect to them over CURVE |
| `STF_ZMQ_CURVE_SECRET_KEY` | | Secret key of the client, with `STF_ZMQ_CURVE_SERVER_PUBLIC_KEY`; its public key is derived from it |

### Ports of the Android devices

`stf provider` gives every device worker a group of 4 ports of `--min-port`..`--max-port` (`STF_PROVIDER_MIN_PORT`, `STF_PROVIDER_MAX_PORT`): the first one is the screen WebSocket, the second one the remote debug port the users connect to (`adb connect`). With `--connect-port` (`STF_PROVIDER_CONNECT_PORT`, mcloud-device passes it) the remote debug port is fixed (`lib/util/zebrunner-connect-port.ts`):

- the port is taken out of the pool, the screen and the other ports never get it; the range needs 4 ports besides it (`7404`..`7410` with `7405`: the screen port is `7404`);
- one device worker holds it at a time, the first one started while it is free. mcloud runs one device per provider; another device started meanwhile gets the second port of its group, with a warning. The port is free again when its worker exits;
- an invalid port (not 1..65535) or a range without the 4 ports stops the provider at start.

Every Android device worker sends its ports to the processor (`DevicePortsMessage`) before it is ready, which stores them in the device document as `screenPort` and `connectPort`, as for the iOS devices. The REST API returns them, e.g. for the adb relay of mcloud: `GET /api/v1/devices?fields=serial,platform,present,display,screenPort,connectPort,provider`.

`stf ios-device` takes the options of a device unit plus `--wda-host`, `--wda-port`, `--mjpeg-port`, `--device-name` and `--host`, see `node lib/cli ios-device --help`.

## REST API

| Route | What it does |
| --- | --- |
| `PUT /api/v1/devices/{serial}` with `{"status": ...}` | `disconnected`, `offline`, `available` (frees the device), `busy` (needs `owner.name`, marks the device as used by the owner), `unauthorized`, `preparing`, `unhealthy` |
| `GET /api/v1/devices/{serial}/size` | the display of the device, `{height: 0, width: 0, scale: 0}` when unknown |
| `GET /api/v1/devices/{serial}/owner` | the owner of the group of the device |
| `GET /api/v1/devices/{serial}/type` | the device type of an iOS device (`iOS`, `tvOS`) |

The routes of the enrolled device hosts (`/api/v1/nodes/...`, `/api/v1/zebrunner/screen-auth`, `/api/v1/zebrunner/nodes/...`) are described in [Nodes (enrollment)](#nodes-enrollment).

The device lists and `GET /api/v1/devices/{serial}` also return `name`, the model of the device, and `screenPort` and `connectPort`, the ports of its worker (Android and iOS, see [Ports of the Android devices](#ports-of-the-android-devices)). The operations tagged `admin` need an admin with the session cookie of the app as with an access token (`lib/units/api/helpers/securityHandlers.ts`; upstream checked the token only).

## Sessions

A sign-in starts a session in the database (`sessions` table, created by `stf migrate`, the `stf-migrate` service of mcloud); the session cookie is httpOnly and SameSite=Lax (Secure behind https). The app, API and websocket units drop a session that ended or is older than `STF_SESSION_TTL_SECONDS`, the users sign in again; the logout of the UI (`POST /app/api/v1/logout`) ends the session on the server. The Zebrunner, LDAP, OAuth2 and mock sign-ins hand the user to the app with a token that expires after two minutes (`lib/util/zebrunner-signin.ts`); the OAuth2 sign-in accepts only an email of `--oauth-domain` (`user@<domain>`) that the provider does not report as unverified (`email_verified`), and after five refused sign-ins of a user within three minutes they answer 429 for three minutes, doubled with every lock up to 30 minutes; the sign-in form tells the user to wait. See `lib/util/authsession.ts` and `lib/util/ratelimit.ts`.

## Storage

With `STF_STORAGE_TOKEN` set, `/s/upload`, `/s/download` and `/s/blob` of the storage units answer only:

- the STF units, with `x-stf-internal-token: <STF_STORAGE_TOKEN>`;
- the device units of an active enrolled node, with `x-stf-internal-token: <node token>`, checked with the API unit (`STF_NODES_API_URL`) and trusted for 30 s, see [Nodes (enrollment)](#nodes-enrollment);
- signed-in users, with the session cookie of the app unit.

The apk and image plugins forward the credentials of their caller, so `/s/apk/...` and `/s/image/...` are protected the same way. The device units download an app to install only from the storage (`storageauth.storageUrl`: `/s/...` of the origin of `--storage-url`), the href of the user cannot send the token elsewhere; the iOS unit runs go-ios and `xcrun` without a shell, launches only a valid bundle identifier and checks the answer of the storage. Scripts that use the storage without a session (e.g. with an access token of the API) are refused. `/s/download` (install from URL) downloads only from public addresses over http(s), checked after the DNS lookup, when connecting and on every redirect; `STF_STORAGE_TEMP_DOWNLOAD_ALLOW` lets private networks in.

Without the token the storage is open as in upstream (open routes, any download URL; `stf local`, the tests) and logs a warning at start. `--storage-token` needs `--secret` (`SECRET`), the secret of the session cookies of the app unit.

## ZeroMQ

The units and the device providers talk over ZeroMQ through the triproxies, which have no authentication in upstream: anyone who reaches their ports reads the events of all the devices and sends commands to them. With the `STF_ZMQ_CURVE_*` variables every tcp endpoint uses [CURVE](http://curvezmq.org) (`lib/util/zmqcurve.ts`, applied by `lib/util/zmqutil.ts` to every socket):

- the triproxies (the only units that bind) are CURVE servers with `STF_ZMQ_CURVE_SERVER_SECRET_KEY`; their ZAP handler accepts the public keys of the `STF_ZMQ_CURVE_CLIENT_KEY_<HOST>` variables and of `STF_ZMQ_CURVE_CLIENT_KEYS` and refuses the others, logging the address and the key once a minute. Without a running ZAP handler libzmq refuses every client (`ZMQ_ZAP_ENFORCE_DOMAIN`);
- the other units and the providers connect as CURVE clients of `STF_ZMQ_CURVE_SERVER_PUBLIC_KEY` with `STF_ZMQ_CURVE_SECRET_KEY`. A client whose key is refused logs `The ZeroMQ server <endpoint> refused the CURVE key <public key> of this host: add it to the server as STF_ZMQ_CURVE_CLIENT_KEY_<HOST>=<key> (or to STF_ZMQ_CURVE_CLIENT_KEYS) and restart it` once a minute per endpoint (the monitor of the socket). libzmq does not connect a refused socket again, not even after the server is restarted with the key: the unit has to restart.

The keys are 64 hex characters: `stf curve-keygen` prints a new pair (`public=...`, `secret=...`), `stf curve-keygen --secret-key <key>` the pair of a secret key. A deployment has one server pair and a client pair for the server units (their public key is accepted by the triproxies as the one of `STF_ZMQ_CURVE_SECRET_KEY`); every device host has its own client pair, its public key goes to a `STF_ZMQ_CURVE_CLIENT_KEY_<HOST>` variable of the server (or to `STF_ZMQ_CURVE_CLIENT_KEYS`) and its removal from there disconnects the host. `./zebrunner.sh setup` of mcloud generates the keys of the server and of the server units. A unit with an incomplete or invalid configuration does not start. Without the variables the sockets have no security, as in upstream (`stf local`, the tests); CURVE is all or nothing for a triproxy, the clients without it cannot connect.

One key per variable is easier to keep than a list: every `STF_ZMQ_CURVE_CLIENT_KEY_<HOST>` variable (`<HOST>` one or more of `[A-Za-z0-9_]`, a free label of the device host) adds its value, exactly one key, to the allowed clients, e.g. in `variables.env` of mcloud (its `env_file` passes them all to the containers):

```
STF_ZMQ_CURVE_CLIENT_KEY_BUILD_UA=<public key of the build-ua host>
STF_ZMQ_CURVE_CLIENT_KEY_MAC_MINI_1=<public key of the mac-mini-1 host>
STF_ZMQ_CURVE_CLIENT_KEY_MAC_MINI_2=
```

An empty variable is ignored (a placeholder); any other value that is not one key of 64 hex characters stops the server with an error naming the variable. `STF_ZMQ_CURVE_CLIENT_KEYS` still works and adds its keys; a key in both places is allowed once. A triproxy logs the number of the allowed keys and the labels of the variables with a key (`CURVE server: 3 client keys are allowed (STF_ZMQ_CURVE_CLIENT_KEY_<HOST> of: BUILD_UA, MAC_MINI_1)`).

With `STF_NODES_API_URL` (and `STF_STORAGE_TOKEN`) the triproxies also let in the keys of the active enrolled nodes and refuse the keys of the revoked nodes and the retired keys of the nodes even when a variable has them (deny wins), read from the API unit every 5 s, see [Nodes (enrollment)](#nodes-enrollment). No restart is needed to add or revoke a node.

The device units find out that their messages do not reach the server from the registration: the processor acks the `DeviceIntroductionMessage` of the provider and the `DeviceReadyMessage` of the `ios-device` unit with a `DeviceRegisteredMessage`. Without the ack in 15 s the unit logs `No registration ack for "<serial>" in 15000 ms: the STF processor does not get the messages of this provider (unit). Check that the ZeroMQ server lets this host in: its CURVE public key as STF_ZMQ_CURVE_CLIENT_KEY_<HOST>=<public key> (or in STF_ZMQ_CURVE_CLIENT_KEYS) of the server (restart the server after a change), STF_ZMQ_CURVE_SERVER_PUBLIC_KEY the one of the server, the triproxy endpoints reachable.` (without CURVE: that the triproxy endpoints are reachable) and exits; the restart of its container is the retry. The provider counts a device as waiting from its discovery, so it no longer gives it up (`Providing all 0 of 1 device(s); ignoring ...`) while the registration is pending; a device that cannot be provided after its registration still makes it exit.

## Nodes (enrollment)

A device host ("node", [mcloud-agent](https://github.com/zebrunner/mcloud-agent)) joins with a one-time invite of an
admin instead of copying the shared secrets of the server, and gets credentials of its own that the admin can revoke.
mcloud wraps the routes in `./zebrunner.sh node-invite` and `./zebrunner.sh nodes`, mcloud-agent in
`./zebrunner.sh join`.

### Flow

1. An admin creates an invite for a label and the address of the node (`POST /api/v1/nodes/invites`). The address is
   the one the server connects to (`STF_PROVIDER_HOST` of the node): chosen by the admin, never by the node.
2. The node enrolls with the invite and its CURVE public key (`POST /api/v1/nodes/enroll`, no authentication, rate
   limited by stf-proxy) and gets its node token, the public key of the triproxies, the public URL of STF and the
   triproxy endpoints. The invite is used once.
3. The node passes its token to its containers: `STF_NODE_TOKEN` and `STF_STORAGE_TOKEN` of the stf container, the
   registration token of Appium in mcloud-grid.
4. The triproxies let the key of the node in within 5 s, the storage accepts its token, mcloud-grid verifies it
   (`POST /api/v1/nodes/verify`), its devices are bound to it (below).
5. Revocation (`POST /api/v1/nodes/{label}/revoke`) stops all of it; a new invite of the label re-enrolls the node with
   a new token and key (rotation).

### Identifiers and secrets

| What | Format | Kept by the server |
| --- | --- | --- |
| label | `^[a-z0-9][a-z0-9-]{0,39}$`, unique; `enroll`, `invites`, `relay` and `verify` are reserved (static paths of `/api/v1/nodes`) | `nodes.label` (primary key) |
| node token | `mcn1.<label>.<secret>`, 32 random bytes in base64url, shown once | `sha256(token)` hex only (`nodes.tokenHash`) |
| invite | `mci1.<secret>`, 32 random bytes in base64url, shown once; 60 minutes by default, at most 1440; single use; bound to the label and the address; a new invite of a label invalidates the unused ones of the label | `sha256(invite)` hex only (`node_invites.hash`) |
| address | an IPv4 address or a host name, lower case; no scheme, port, path or IPv6; not loopback (`127/8`, `localhost`), `0/8`, link-local or metadata (`169.254/16`, `metadata.google.internal`, ...), multicast or reserved (`224/3`); unique among the nodes | `nodes.address` |

The tables are `nodes` {label, address, publicKey, tokenHash, status (`active`, `revoked`), createdAt, revokedAt,
lastSeenAt, generation (+1 on every re-enrollment), retiredKeys (the keys of the previous enrollments)} and
`node_invites` {hash, label, address, expiresAt, usedAt, createdBy, createdAt}, created by `stf migrate`
(`lib/db/tables.ts`); a device document gets `node` and `nodeGeneration`.

### Routes

Every error is a generic `{"success": false}` (400: malformed or refused input, 403: refused credentials, 500: the
server), the reason is in the log of the API unit; no token or invite is ever logged. The admin routes take an
admin, with an access token (`Authorization: Bearer <token>`, the `STF_TOKEN` of mcloud) or the session cookie; the
security handler answers 401 without credentials and 403 to a user.

| Route | Who | Request | Answer |
| --- | --- | --- | --- |
| `POST /api/v1/nodes/invites` | admin | `{"label": "mac-mini-1", "address": "10.0.0.5", "ttlMinutes": 60}` | 201 `{"invite": "mci1....", "label": "mac-mini-1", "address": "10.0.0.5", "expiresAt": "2026-11-09T18:00:00.000Z"}` |
| `POST /api/v1/nodes/enroll` | anyone with an invite | `{"invite": "mci1....", "label": "mac-mini-1", "publicKey": "<64 hex>"}` | 200 `{"nodeToken": "mcn1.mac-mini-1....", "label": "mac-mini-1", "address": "10.0.0.5", "serverPublicKey": "<64 hex>", "stfUrl": "https://mcloud.example.com", "endpoints": {"sub": "tcp://10.0.0.1:7250", "push": "tcp://10.0.0.1:7270", "appDealer": "tcp://10.0.0.1:7160", "devDealer": "tcp://10.0.0.1:7260"}}` |
| `GET /api/v1/nodes` | admin | | 200 `{"nodes": [{"label", "address", "publicKey", "status", "createdAt", "revokedAt", "lastSeenAt"}]}` |
| `POST /api/v1/nodes/{label}/revoke` | admin | | 200 `{"success": true}`; 400 for an unknown node |
| `DELETE /api/v1/nodes/{label}` | admin | | 200 `{"success": true}`; 400 for an unknown or active node |
| `POST /api/v1/nodes/verify` | admin (mcloud-grid) | `{"token": "mcn1....", "host": "10.0.0.5"}` | 200 `{"label": "mac-mini-1", "address": "10.0.0.5"}` only for the token of an active node whose address is the host (case-insensitive), else 403; updates lastSeenAt at most once a minute |
| `GET /api/v1/nodes/relay` | admin (adb relay) | | 200 `{"devices": [{"serial": "R58M...", "label": "mac-mini-1", "address": "10.0.0.5", "connectPort": 7405}]}`: every Android device bound to an active node, present or not (the relay stays static, the node refuses the connections of an absent device); the address is the registered one of the node, never the display URL; the port is the connect port of the device, else its screen port + 1 |
| `GET /api/v1/zebrunner/screen-auth` | the user (session cookie or access token) | header `X-Original-URI: /d/<host>/<serial>/<port>/` | 204, or 401 without credentials, 403 otherwise (below) |
| `GET /api/v1/zebrunner/nodes/keys` | server units (`x-stf-internal-token: <STF_STORAGE_TOKEN>`) | | 200 `{"allowed": [<keys of the active nodes>], "denied": [<keys of the revoked nodes and the retired keys>]}` |
| `POST /api/v1/zebrunner/nodes/token` | server units (`x-stf-internal-token: <STF_STORAGE_TOKEN>`) | `{"token": "mcn1...."}` | 200 `{"label": "mac-mini-1"}` for the token of an active node, else 403 |

The enrollment checks the shape of the request first (no database), then looks the invite up by its hash; only the
holder of a valid invite gets further. The invite is used by one atomic conditional update of RethinkDB (unused,
unexpired, of the label), so of concurrent enrollments with one invite exactly one succeeds. The key of another node
(current or retired) and the address of another node are refused before the invite is used. A re-enrollment of a label
replaces the address, the key and the token hash and increments the generation: the old token and key stop working at
once (the old key is kept in `retiredKeys`, refused by the triproxies). The invites and the enrollments of an API unit
run one at a time, which keeps the address and the key unique: mcloud runs one API unit.

### Device binding

The provider and the `ios-device` unit read `STF_NODE_TOKEN` and send with the registration of a device (Android:
`DevicePortsMessage`, iOS: `InitializeIosDeviceState`) the label, the host of the provider (`--host`,
`STF_PROVIDER_HOST`) and `nodeProof` = hex HMAC-SHA256(key = the raw sha256 of the token,
`v1|<serial>|<providerHost>|<screenPort>|<connectPort>`) (`lib/util/zebrunner-nodes.ts`). The processor
(`lib/units/processor/zebrunner-nodes.ts`) binds the device (`node`, `nodeGeneration`) when the node is active, the
proof is valid with its token hash and the host is its address. Otherwise the device is unbound, and if the host is the
address of a registered node the registration is rejected and logged: the device gets no ports and no binding and is
not made ready (an `ios-device` unit gets no registration ack and exits). A device is bound only while its node is
active and has the generation of the binding: revocation and rotation unbind the devices (screens and relay refused)
until they register again with the new token.

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
user uses it (or is an admin), and either the device is bound to an active node whose address is the host and the port
is the screen port of the device, or (a legacy unbound device) the host is in `AGENT_HOSTS` of the API unit, is not the
address of any registered node, and the port and the screen URL of the device (`display.url`) are its own.

### Security properties

- Only hashes of tokens and invites are stored; they are compared through their sha256 in constant time and never
  logged. The node token is shown once.
- An invite is single use, short lived, bound to a label and an address the admin chose; the node cannot choose where
  the server connects to.
- Errors are generic, so the enrollment is no oracle; a malformed enrollment costs no database access, an unknown
  invite one primary key lookup (stf-proxy rate limits the route).
- Every node has its own token and CURVE key, revoked on its own without a restart: the triproxies refuse the key of a
  revoked node within 5 s even if a legacy variable allows it, the storage refuses its token within 30 s, mcloud-grid
  within its verification interval, its devices lose their binding at once.
- The triproxies and the storage units get no database access: they ask the API unit, authenticated with the token of
  the server units, which only answers public keys and yes/no; the token hashes never leave the API unit (they are the
  keys of the node proofs).
- The relay and the screens use the registered address of a node, never what a device reports.

### Residual risks

- Existing ZeroMQ sessions of a revoked node survive until the triproxies restart: ZAP checks new connections only.
  `./zebrunner.sh nodes revoke` of mcloud restarts them.
- A compromised active node can still lie about its own devices (their state, screens and ports on its own address);
  it cannot bind devices to another node or address.
- The LAN traffic to the grid (Appium of the nodes) is plain HTTP: a node token can be sniffed there, but it is bound
  to the address of its node for the grid, the device binding and the relay.
- A deleted node no longer has its key refused: a key still in a legacy variable is allowed again. Remove the legacy
  variables (`./zebrunner.sh nodes legacy-off`) before deleting revoked nodes.
- The uniqueness of the address and key is kept by the API unit serializing the enrollments: several API units could
  race on two different invites with the same address (one invite is still used once).
- A host name address can resolve to a forbidden address; only the literal is checked.

## Development

| Command | What it checks |
| --- | --- |
| `make check` | `make lint` and `make test`, every one of them, as CI; fails when one failed |
| `make lint` | the Lint job of CI: `npm run lint` and the shell of the `run:` blocks of the workflows (`.github/scripts/check-run-blocks.mts`) |
| `make test` | the Unit tests job of CI: `npm run test:unit` |
| `node build.mts compile` | compiles `lib/` (the tests and `stf` run the compiled files) |
| `npm run lint` | eslint, type checks, JSON and the translation template |
| `npm run test:unit` | the mocha tests of `test/`, the fork ones are in `test/units/zebrunner/` |
| `npm run test:component` | the vitest tests of the UI, the fork ones are `*.zebrunner.test.ts` and `device-list/zebrunner.test.ts` |

The `make` targets are thin wrappers over the npm scripts. They run `npm ci` first when `node_modules` is missing or older than `package-lock.json` (the stamp is `node_modules/.package-lock.json`, the hidden lock file npm writes); the `prepare` script of `npm ci` builds `lib/` and the UI.

### CI

- CI runs on PRs and pushes to `develop`/`master`. Android starts at Android 12 (API 31): `.github/zebrunner-ci.json` sets the lowest API level; `.github/android-matrix.json` stays the upstream file. `.github/scripts/zebrunner-ci.mts` selects the same coverage for the job matrices and the report.
- The default `quick` profile tests the oldest supported OS and the newest stable revision of each of the two newest OS majors: currently Android API 31, 36.1 and 37.1, and iOS 15, 18 and 26. Optional iOS previews and non-stable Android SDK channels are full-only. Build, lint, unit, component, integration and Compose still run normally.
- Run all configured versions manually with `gh workflow run ci.yml --ref develop -f matrix-profile=full` (or Actions > CI > Run workflow > `full`). The full CI also runs every Monday at 04:00 UTC. The report states the profile, identifies untested versions and treats missing verdicts within the selected profile as failures.
- `.github/workflows/zebrunner-ios.yml` tests the WDA client of the `ios-device` unit against WebDriverAgent on iOS simulators: iOS 15 (runtime from `xcodes`), 16, 17 (runtimes downloaded for Xcode 16.4), 18, 26 and 27 (the `xcode-27` preview image); the full matrix is `ios.include` of `.github/zebrunner-ci.json`. `ci.yml` passes its profile to this workflow; a standalone manual iOS run defaults to `full`. Tests start from a fresh session and the home screen rather than depending on previous test state. CI allows two retries per Playwright/iOS test; recovered failures are explicitly reported as flaky. WDA startup already has three attempts and Android has two whole-leg attempts; increasing those would only lengthen deterministic failures. iOS 27's known XCTest startup failure remains an explicit optional warning, not a passing capability check. Locally, on a Mac with Xcode:

  ```bash
  node build.mts compile
  bash .github/scripts/zebrunner-ios-simulator.sh 27
  IOS_VERSION=27 npx mocha --exit --extension mts test/zebrunner-ios
  ```

### Keeping up with upstream

The fork merges [DeviceFarmer/stf](https://github.com/DeviceFarmer/stf) `master` (remote `upstream`) regularly, so its changes are kept where a merge does not reach them:

- fork code goes to new files (`zebrunner` in the name, or `lib/units/ios-device/`); an upstream file only gets the lines that call it, marked with a `Fork (Zebrunner)` comment;
- fork tests go to `test/units/zebrunner/` and `*.zebrunner.test.ts`, the runners find them without a configuration change;
- a new wire message takes a free code above the upstream ones and is pinned in `test/wire/protobuf.mts`; a retired code is added to `reserved`;
- `res/common/lang/po/stf.pot`: add and remove the fork messages only, do not commit a fully regenerated file (the translation check compares the messages, not the source references);
- `api_v1_generated.json` stays the upstream file, the API unit reads `api_v1.yaml`;
- `package-lock.json` and `test/playwright/package-lock.json` are committed (upstream ignores them): the image and CI install them with `npm ci`. After a merge that changes `package.json`, `npm install` updates the lock file, commit it with the merge; `npm audit` should stay clean, `overrides` in `package.json` pins the fixed versions of nested dependencies;
- no editor settings, generated files or permission changes.

A sync: `git fetch upstream && git merge upstream/master`, `npm install` when `package.json` changed, then `make check` and `npm run test:component`.

### Conventions

The repository follows [mcloud-conventions](https://github.com/zebrunner/mcloud-conventions) where they do not touch upstream files: [Conventional Commits](https://www.conventionalcommits.org/), `kebab-case` branch names, pull requests into `develop`, ASCII-only documentation. The `Makefile` has the targets of the conventions (`help`, `check`, `lint`, `test`, then `build` and `push`) over the npm scripts, without `docker`: the image has no tests of its own. It is not synced by mcloud-conventions: `LICENSE`, `.editorconfig`, `.gitignore` and the lint setup belong to upstream and the shell checks do not apply to a Node.js project.

## Support

[Zebrunner](https://zebrunner.com), the issues of [zebrunner/stf](https://github.com/zebrunner/stf/issues).

## License

[Apache License 2.0](LICENSE)
