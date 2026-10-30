# Zebrunner STF

The STF of [Zebrunner MCloud](https://github.com/zebrunner/mcloud): a fork of [DeviceFarmer/stf](https://github.com/DeviceFarmer/stf) that adds iOS and tvOS devices, the sign-in through Zebrunner, the device status API of the Zebrunner device management and the authentication of the storage. Everything else is upstream STF; [README.md](README.md) and [doc/](doc/) describe it.

The image `public.ecr.aws/zebrunner/stf` runs the STF units of [mcloud](https://github.com/zebrunner/mcloud) and is the base of the device image [mcloud-device](https://github.com/zebrunner/mcloud-device), which runs one provider (Android) or one `ios-device` unit (iOS, tvOS) per device, started by [mcloud-agent](https://github.com/zebrunner/mcloud-agent).

## What the fork adds

| Feature | Where |
| --- | --- |
| iOS/tvOS device unit: screen, touch, keys, install of `.ipa`, clipboard, Wi-Fi and Bluetooth through WebDriverAgent; device log, shell and files through go-ios, see [iOS devices](#ios-devices) | `lib/units/ios-device/`, `lib/cli/ios-device/` |
| iOS messages of the wire protocol, codes 98-127 (the retired ones are reserved) | `lib/wire/wire.proto` (after the upstream messages) |
| iOS device state in the database | `lib/db/zebrunner.ts`, `lib/units/processor/` |
| Sign-in through the Zebrunner IAM service | `lib/units/auth/zebrunner.ts`, `lib/cli/auth-zebrunner/`, `res/app/src/entries/auth-zebrunner.tsx` |
| Device status, size, owner and type routes of the REST API | `lib/units/api/controllers/zebrunner.ts`, `lib/units/api/helpers/device-status.ts` |
| Authentication of the storage routes and SSRF protection of downloads | `lib/util/storageauth.ts`, `lib/util/urlsafety.ts` |
| One provider per device container: fixed VNC port, `UNHEALTHY` and exit when the device cannot be provided or the processor does not ack its registration, see [ZeroMQ](#zeromq) | `lib/cli/provider/`, `lib/units/provider/` |
| `.ipa` manifests (Info.plist) in the apk storage plugin | `lib/units/storage/plugins/apk/task/` |
| The WebSocket sends the commands of a user (input, shell, install, remote ADB, files, ...) to the devices the user uses only (an admin: to any device), the invitations to the devices of the groups of the user, and subscribes the client to the channels of its transactions only: the channel of a device is `base64(sha1(serial))`, so any user controlled any device. A released device gets no command later than 2 s after it | `lib/units/websocket/zebrunner-channels.ts`, `lib/db/zebrunner.ts` |
| A malformed ZeroMQ message or WebSocket event (or a listener failing on it) is logged once a minute and dropped instead of ending the unit: the listeners run in `process.nextTick`, so their exceptions were uncaught | `lib/util/zebrunner-guard.ts`, `lib/wire/router.ts`, `lib/units/websocket/index.ts` |
| UI: iOS/tvOS controls, the app under `/stf`, device list filter and scroll position | `res/app/src/` (`zebrunner` in the file name, or marked `Fork (Zebrunner)`) |

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
| `STF_STORAGE_TOKEN` | | Token the STF units send to the storage (`x-stf-internal-token`); set for `storage-temp`/`storage-s3` (`variables.env` of mcloud, `./zebrunner.sh setup` generates it) and, the same value, for the device containers (mcloud-agent). It turns the protection of the storage on, the Zebrunner deployments must set it, see [Storage](#storage) |
| `STF_STORAGE_TEMP_DOWNLOAD_ALLOW` | | Private network (CIDR or address) users may install apps from by URL, e.g. an artifact server; `--download-allow` can be repeated |
| `SSID` | `ssid` | Name of the session cookie of the app unit |
| `STF_SESSION_TTL_SECONDS` | `86400` | Lifetime of a session after the sign-in, see [Sessions](#sessions) |
| `ZEBRUNNER_LOGIN_URL` | | Login endpoint of Zebrunner IAM (`.../api/iam/v1/auth/login`), for `auth-zebrunner` |
| `ZEBRUNNER_USERINFO_URL` | | User endpoint of Zebrunner IAM (`.../api/iam/v1/users`), for `auth-zebrunner` |
| `STF_ADMIN_EMAIL`, `STF_ADMIN_NAME` | `administrator@fakedomain.com`, `administrator` | Owner of the root group and of the iOS devices |
| `STF_PROVIDER_DEVICE_NAME` | | Name of the device of the container, shown as its model |
| `STF_PROVIDER_HOST` | `127.0.0.1` | Host of the device container; declared because the containers set it (the CLI is strict) |
| `STF_PROVIDER_VNC_PORT` | `5900` | VNC port of the single device of a provider |
| `STF_PROCESSOR_PUBLIC_IP` | `localhost` | Host of the screen URLs of iOS devices without a URL pattern |
| `STF_ZMQ_CURVE_SERVER_SECRET_KEY` | | Secret key of the triproxies: their tcp endpoints are CURVE servers that accept only the clients of `STF_ZMQ_CURVE_CLIENT_KEYS`, see [ZeroMQ](#zeromq) |
| `STF_ZMQ_CURVE_CLIENT_KEYS` | | Public keys of the clients the triproxies accept (the device hosts), separated by commas or spaces; the key of `STF_ZMQ_CURVE_SECRET_KEY` of the triproxy is accepted too |
| `STF_ZMQ_CURVE_SERVER_PUBLIC_KEY` | | Public key of the triproxies: the units and the device providers connect to them over CURVE |
| `STF_ZMQ_CURVE_SECRET_KEY` | | Secret key of the client, with `STF_ZMQ_CURVE_SERVER_PUBLIC_KEY`; its public key is derived from it |

`stf ios-device` takes the options of a device unit plus `--wda-host`, `--wda-port`, `--mjpeg-port`, `--device-name` and `--host`, see `node lib/cli ios-device --help`.

## REST API

| Route | What it does |
| --- | --- |
| `PUT /api/v1/devices/{serial}` with `{"status": ...}` | `disconnected`, `offline`, `available` (frees the device), `busy` (needs `owner.name`, marks the device as used by the owner), `unauthorized`, `preparing`, `unhealthy` |
| `GET /api/v1/devices/{serial}/size` | the display of the device, `{height: 0, width: 0, scale: 0}` when unknown |
| `GET /api/v1/devices/{serial}/owner` | the owner of the group of the device |
| `GET /api/v1/devices/{serial}/type` | the device type of an iOS device (`iOS`, `tvOS`) |

The device lists and `GET /api/v1/devices/{serial}` also return `name`, the model of the device. The operations tagged `admin` need an admin with the session cookie of the app as with an access token (`lib/units/api/helpers/securityHandlers.ts`; upstream checked the token only).

## Sessions

A sign-in starts a session in the database (`sessions` table, created by `stf migrate`, the `stf-migrate` service of mcloud); the session cookie is httpOnly and SameSite=Lax (Secure behind https). The app, API and websocket units drop a session that ended or is older than `STF_SESSION_TTL_SECONDS`, the users sign in again; the logout of the UI (`POST /app/api/v1/logout`) ends the session on the server. The Zebrunner, LDAP, OAuth2 and mock sign-ins hand the user to the app with a token that expires after two minutes (`lib/util/zebrunner-signin.ts`); the OAuth2 sign-in accepts only an email of `--oauth-domain` (`user@<domain>`) that the provider does not report as unverified (`email_verified`), and after five refused sign-ins of a user within three minutes they answer 429 for three minutes, doubled with every lock up to 30 minutes; the sign-in form tells the user to wait. See `lib/util/authsession.ts` and `lib/util/ratelimit.ts`.

## Storage

With `STF_STORAGE_TOKEN` set, `/s/upload`, `/s/download` and `/s/blob` of the storage units answer only:

- the STF units, with `x-stf-internal-token: <STF_STORAGE_TOKEN>`;
- signed-in users, with the session cookie of the app unit.

The apk and image plugins forward the credentials of their caller, so `/s/apk/...` and `/s/image/...` are protected the same way. The device units download an app to install only from the storage (`storageauth.storageUrl`: `/s/...` of the origin of `--storage-url`), the href of the user cannot send the token elsewhere; the iOS unit runs go-ios and `xcrun` without a shell, launches only a valid bundle identifier and checks the answer of the storage. Scripts that use the storage without a session (e.g. with an access token of the API) are refused. `/s/download` (install from URL) downloads only from public addresses over http(s), checked after the DNS lookup, when connecting and on every redirect; `STF_STORAGE_TEMP_DOWNLOAD_ALLOW` lets private networks in.

Without the token the storage is open as in upstream (open routes, any download URL; `stf local`, the tests) and logs a warning at start. `--storage-token` needs `--secret` (`SECRET`), the secret of the session cookies of the app unit.

## ZeroMQ

The units and the device providers talk over ZeroMQ through the triproxies, which have no authentication in upstream: anyone who reaches their ports reads the events of all the devices and sends commands to them. With the `STF_ZMQ_CURVE_*` variables every tcp endpoint uses [CURVE](http://curvezmq.org) (`lib/util/zmqcurve.ts`, applied by `lib/util/zmqutil.ts` to every socket):

- the triproxies (the only units that bind) are CURVE servers with `STF_ZMQ_CURVE_SERVER_SECRET_KEY`; their ZAP handler accepts the public keys of `STF_ZMQ_CURVE_CLIENT_KEYS` and refuses the others, logging the address and the key once a minute. Without a running ZAP handler libzmq refuses every client (`ZMQ_ZAP_ENFORCE_DOMAIN`);
- the other units and the providers connect as CURVE clients of `STF_ZMQ_CURVE_SERVER_PUBLIC_KEY` with `STF_ZMQ_CURVE_SECRET_KEY`. A client whose key is refused logs `The ZeroMQ server <endpoint> refused the CURVE key <public key> of this host: add it to STF_ZMQ_CURVE_CLIENT_KEYS of the server and restart it` once a minute per endpoint (the monitor of the socket). libzmq does not connect a refused socket again, not even after the server is restarted with the key: the unit has to restart.

The keys are 64 hex characters: `stf curve-keygen` prints a new pair (`public=...`, `secret=...`), `stf curve-keygen --secret-key <key>` the pair of a secret key. A deployment has one server pair and a client pair for the server units (their public key is accepted by the triproxies as the one of `STF_ZMQ_CURVE_SECRET_KEY`); every device host has its own client pair, its public key goes to `STF_ZMQ_CURVE_CLIENT_KEYS` and its removal from there disconnects the host. `./zebrunner.sh setup` of mcloud generates the keys of the server and of the server units. A unit with an incomplete or invalid configuration does not start. Without the variables the sockets have no security, as in upstream (`stf local`, the tests); CURVE is all or nothing for a triproxy, the clients without it cannot connect.

The device units find out that their messages do not reach the server from the registration: the processor acks the `DeviceIntroductionMessage` of the provider and the `DeviceReadyMessage` of the `ios-device` unit with a `DeviceRegisteredMessage`. Without the ack in 15 s the unit logs `No registration ack for "<serial>" in 15000 ms: the STF processor does not get the messages of this provider (unit). Check that the ZeroMQ server lets this host in: its CURVE public key <public key> in STF_ZMQ_CURVE_CLIENT_KEYS of the server (restart the server after a change), STF_ZMQ_CURVE_SERVER_PUBLIC_KEY the one of the server, the triproxy endpoints reachable.` (without CURVE: that the triproxy endpoints are reachable) and exits; the restart of its container is the retry. The provider counts a device as waiting from its discovery, so it no longer gives it up (`Providing all 0 of 1 device(s); ignoring ...`) while the registration is pending; a device that cannot be provided after its registration still makes it exit.

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

- The upstream workflows run as they are, except that the Android emulator legs start at Android 12 (API 31): `.github/zebrunner-ci.json` sets the lowest API level and `.github/scripts/zebrunner-ci.mts` applies it to the matrix and to the coverage check of the report; `.github/android-matrix.json` stays the upstream file.
- `.github/workflows/zebrunner-ios.yml` tests the WDA client of the `ios-device` unit against WebDriverAgent on iOS simulators: iOS 15 (runtime from `xcodes`), 16, 17 (runtimes downloaded for Xcode 16.4), 18, 26 and 27 (the `xcode-27` preview image); the matrix is `ios.include` of `.github/zebrunner-ci.json`. `ci.yml` runs it with its other legs, and its report shows an iOS matrix next to the Android one (`render-report.mts` with `zebrunner-ci.mts`); it also runs weekly and by hand. Locally, on a Mac with Xcode:

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
