# Zebrunner STF

The STF of [Zebrunner MCloud](https://github.com/zebrunner/mcloud): a fork of [DeviceFarmer/stf](https://github.com/DeviceFarmer/stf) that adds iOS and tvOS devices, the sign-in through Zebrunner, the device status API of the Zebrunner device management and the authentication of the storage. Everything else is upstream STF; [README.md](README.md) and [doc/](doc/) describe it.

The image `public.ecr.aws/zebrunner/stf` runs the STF units of [mcloud](https://github.com/zebrunner/mcloud) and is the base of the device image [mcloud-device](https://github.com/zebrunner/mcloud-device), which runs one provider (Android) or one `ios-device` unit (iOS, tvOS) per device, started by [mcloud-agent](https://github.com/zebrunner/mcloud-agent).

## What the fork adds

| Feature | Where |
| --- | --- |
| iOS/tvOS device unit: screen, touch, keys, install of `.ipa`, logs, clipboard through WebDriverAgent and go-ios | `lib/units/ios-device/`, `lib/cli/ios-device/` |
| iOS messages of the wire protocol, codes 98-125 (the retired ones are reserved) | `lib/wire/wire.proto` (after the upstream messages) |
| iOS device state in the database | `lib/db/zebrunner.ts`, `lib/units/processor/` |
| Sign-in through the Zebrunner IAM service | `lib/units/auth/zebrunner.ts`, `lib/cli/auth-zebrunner/`, `res/app/src/entries/auth-zebrunner.tsx` |
| Device status, size, owner and type routes of the REST API | `lib/units/api/controllers/zebrunner.ts`, `lib/units/api/helpers/device-status.ts` |
| Authentication of the storage routes and SSRF protection of downloads | `lib/util/storageauth.ts`, `lib/util/urlsafety.ts` |
| One provider per device container: fixed VNC port, `UNHEALTHY` and exit when the device cannot be provided | `lib/cli/provider/`, `lib/units/provider/` |
| `.ipa` manifests (Info.plist) in the apk storage plugin | `lib/units/storage/plugins/apk/task/` |
| UI: iOS/tvOS controls, the app under `/stf`, device list filter and scroll position | `res/app/src/` |

## Image contents

| Component | Why |
| --- | --- |
| STF with the fork, Node.js 22, bundletool | the STF units |
| `libplist-utils` (`plistutil`) | reads the binary `Info.plist` of uploaded `.ipa` files |
| iOS, Android and tvOS icons | replace the generic icons of `@devicefarmer/stf-device-db` |

go-ios, socat and curl, which the `ios-device` unit and the scripts of the device containers use, are installed by the mcloud-device image.

## Build

```bash
docker build -t public.ecr.aws/zebrunner/stf:dev .
```

Without docker (Node.js 22.18 or later):

```bash
npm ci
node build.mts build
```

## Run

The units are started by the `docker-compose.yml` of mcloud (`stf app`, `stf auth-zebrunner`, `stf processor`, `stf storage-temp`, ...) and by `start_all.sh` of mcloud-device (`stf provider` for Android, `node /app/lib/cli ios-device` for iOS). For development, `stf local` starts all the server units on one machine, `--auth-type zebrunner` uses the Zebrunner sign-in.

## Configuration

The variables the fork adds or the Zebrunner deployment relies on, the other options of every unit are listed by `stf <unit> --help`.

| Variable | Default | Description |
| --- | --- | --- |
| `SECRET` | | Secret of the session cookies and tokens: `--secret` of `app`, `auth-*`, `websocket` and, in the fork, of `storage-temp`/`storage-s3` |
| `STF_STORAGE_TOKEN` | | Token the STF units send to the storage (`x-stf-internal-token`); set for `storage-temp`/`storage-s3` (mcloud `variables.env`) and for the device containers (mcloud-agent). It turns the protection of the storage on, the Zebrunner deployments must set it |
| `STF_STORAGE_TEMP_DOWNLOAD_ALLOW` | | Private network (CIDR or address) users may install apps from by URL, e.g. an artifact server; `--download-allow` can be repeated |
| `SSID` | `ssid` | Name of the session cookie of the app unit |
| `ZEBRUNNER_LOGIN_URL` | | Login endpoint of Zebrunner IAM (`.../api/iam/v1/auth/login`), for `auth-zebrunner` |
| `ZEBRUNNER_USERINFO_URL` | | User endpoint of Zebrunner IAM (`.../api/iam/v1/users`), for `auth-zebrunner` |
| `STF_ADMIN_EMAIL`, `STF_ADMIN_NAME` | `administrator@fakedomain.com`, `administrator` | Owner of the root group and of the iOS devices |
| `STF_PROVIDER_DEVICE_NAME` | | Name of the device of the container, shown as its model |
| `STF_PROVIDER_HOST` | `127.0.0.1` | Host of the device container; declared because the containers set it (the CLI is strict) |
| `STF_PROVIDER_VNC_PORT` | `5900` | VNC port of the single device of a provider |
| `STF_PROCESSOR_PUBLIC_IP` | `localhost` | Host of the screen URLs of iOS devices without a URL pattern |

`stf ios-device` takes the options of a device unit plus `--wda-host`, `--wda-port`, `--mjpeg-port`, `--device-name` and `--host`, see `node lib/cli ios-device --help`.

## REST API

| Route | What it does |
| --- | --- |
| `PUT /api/v1/devices/{serial}` with `{"status": ...}` | `disconnected`, `offline`, `available` (frees the device), `busy` (needs `owner.name`, marks the device as used by the owner), `unauthorized`, `preparing`, `unhealthy` |
| `GET /api/v1/devices/{serial}/size` | the display of the device, `{height: 0, width: 0, scale: 0}` when unknown |
| `GET /api/v1/devices/{serial}/owner` | the owner of the group of the device |
| `GET /api/v1/devices/{serial}/type` | the device type of an iOS device (`iOS`, `tvOS`) |

The device lists and `GET /api/v1/devices/{serial}` also return `name`, the model of the device.

## Storage

With `STF_STORAGE_TOKEN` set, `/s/upload`, `/s/download` and `/s/blob` of the storage units answer only:

- the STF units, with `x-stf-internal-token: <STF_STORAGE_TOKEN>`;
- signed-in users, with the session cookie of the app unit.

The apk and image plugins forward the credentials of their caller, so `/s/apk/...` and `/s/image/...` are protected the same way. Scripts that used the storage without a session (e.g. with an access token of the API) are refused. `/s/download` (install from URL) downloads only from public addresses over http(s), checked after the DNS lookup, when connecting and on every redirect; `STF_STORAGE_TEMP_DOWNLOAD_ALLOW` lets private networks in.

Without the token the storage works as in upstream (open routes, any download URL) and logs a warning at start: the upstream tests and CI use it that way. `--storage-token` needs `--secret` (`SECRET`), the secret of the session cookies of the app unit.

## Upgrade

From the images built from `develop` (3.0 and earlier):

- set `STF_STORAGE_TOKEN` in `variables.env` of mcloud (`./zebrunner.sh setup` generates it), the same value as `STF_STORAGE_TOKEN` of mcloud-agent; without it the storage stays open;
- use a mcloud-device image that installs go-ios, socat and curl itself;
- `stf storage-temp` still accepts the `--connect-push`/`--connect-sub` mcloud passes, they are not used.

## Development

| Command | What it checks |
| --- | --- |
| `node build.mts compile` | compiles `lib/` (the tests and `stf` run the compiled files) |
| `npm run lint` | eslint, type checks, JSON and the translation template |
| `npm run test:unit` | the mocha tests of `test/`, the fork ones are in `test/units/zebrunner/` |
| `npm run test:component` | the vitest tests of the UI, the fork ones are `*.zebrunner.test.ts` and `device-list/zebrunner.test.ts` |

### Keeping up with upstream

The fork merges [DeviceFarmer/stf](https://github.com/DeviceFarmer/stf) `master` (remote `upstream`) regularly, so its changes are kept where a merge does not reach them:

- fork code goes to new files (`zebrunner` in the name, or `lib/units/ios-device/`); an upstream file only gets the lines that call it, marked with a `Fork (Zebrunner)` comment;
- fork tests go to `test/units/zebrunner/` and `*.zebrunner.test.ts`, the runners find them without a configuration change;
- a new wire message takes a free code above the upstream ones and is pinned in `test/wire/protobuf.mts`; a retired code is added to `reserved`;
- `res/common/lang/po/stf.pot`: add and remove the fork messages only, do not commit a fully regenerated file (the translation check compares the messages, not the source references);
- `api_v1_generated.json` stays the upstream file, the API unit reads `api_v1.yaml`;
- no editor settings, generated files or permission changes.

A sync: `git fetch upstream && git merge upstream/master`, then `npm run lint`, `npm run test:unit` and `npm run test:component`.

### Conventions

The repository follows [mcloud-conventions](https://github.com/zebrunner/mcloud-conventions) where they do not touch upstream files: [Conventional Commits](https://www.conventionalcommits.org/), `kebab-case` branch names, pull requests into `develop`, ASCII-only documentation. It is not synced by mcloud-conventions: `LICENSE`, `.editorconfig`, `.gitignore` and the lint setup belong to upstream and the shell checks do not apply to a Node.js project.

## Support

[Zebrunner](https://zebrunner.com), the issues of [zebrunner/stf](https://github.com/zebrunner/stf/issues).

## License

[Apache License 2.0](LICENSE)
