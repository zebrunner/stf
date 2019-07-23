<img src="res/common/logo/exports/STF-128.png?raw=true" style="width:100px;height:100px;" alt="STF">

[![Build Status](https://travis-ci.org/openstf/stf.svg?branch=master)](https://travis-ci.org/openstf/stf)
[![Docker Pulls](https://img.shields.io/docker/pulls/openstf/stf.svg)](https://hub.docker.com/r/openstf/stf/)
[![NPM version](https://img.shields.io/npm/v/stf.svg)](https://www.npmjs.com/package/stf)
[![Backers on Open Collective](https://opencollective.com/openstf/backers/badge.svg)](#backers) [![Sponsors on Open Collective](https://opencollective.com/openstf/sponsors/badge.svg)](#sponsors)

**iSTF** (or Smartphone Test Farm for iOS) is a web application for debugging smartphones, smartwatches and other Apple gadgets remotely, from the comfort of your browser.

## Features

* OS support
  - iOS
    * Supported XCode [TBD]
  - Android
    * Supports versions 2.3.3 (SDK level 10) to 9.0 (SDK level 28)
    * Supports Wear 5.1 (but not 5.0 due to missing permissions)
    * Supports Fire OS, CyanogenMod, and other heavily Android based distributions
    * `root` is **not** required for any current functionality
* Remote control any device from your browser. TODO: review list of actions
  - Real-time screen view
    * Refresh speed can reach 30-40 FPS depending on specs and Android version. See [minicap](https://github.com/openstf/minicap) for more information.
    * Rotation support
  - Supports typing text from your own keyboard
    * Supports meta keys
    * Copy and paste support (although it can be a bit finicky on older devices, you may need to long-press and select paste manually)
    * May sometimes not work well with non-Latin languages unfortunately.
  - Multitouch support on touch screens via [minitouch](https://github.com/openstf/minitouch), two finger pinch/rotate/zoom gesture support on regular screens by pressing `Alt` while dragging
  - Drag & drop installation and launching of `.apk` files
    * Launches main launcher activity if specified in the manifest
  - Reverse port forwarding via [minirev](https://github.com/openstf/minirev)
    * Access your local server directly from the device, even if it's not on the same network
  - Open websites easily in any browser
    * Installed browsers are detected in real time and shown as selectable options
    * Default browser is detected automatically if selected by the user
  - Execute shell commands and see real-time output
  - Display and filter device logs
  - Use `adb connect` to connect to a remote device as if it was plugged in to your computer, regardless of [ADB](http://developer.android.com/tools/help/adb.html) mode and whether you're connected to the same network
    * Run any `adb` command locally, including shell access
    * [Android Studio](http://developer.android.com/tools/studio/index.html) and other IDE support, debug your app while watching the device screen on your browser
    * Supports [Chrome remote debug tools](https://developer.chrome.com/devtools/docs/remote-debugging)
  - File Explorer to access device file system
  - Experimental VNC support (work in progress)
* Manage your device inventory
  - See which devices are connected, offline/unavailable (indicating a weak USB connection), unauthorized or unplugged
  - See who's using a device
  - Search devices by phone number, IMEI, ICCID, Android version, operator, product name and/or many other attributes with easy but powerful queries
  - Show a bright red screen with identifying information on a device you need to locate physically
  - Track battery level and health
  - Rudimentary Play Store account management
    * List, remove and add new accounts (adding may not work on all devices)
  - Display hardware specs
* Simple REST [API](doc/API.md)

## Requirements

* [Node.js](https://nodejs.org/) >= 6.9 (latest stable version preferred)
* [ADB](http://developer.android.com/tools/help/adb.html) properly set up
* [RethinkDB](http://rethinkdb.com/) >= 2.2
* [GraphicsMagick](http://www.graphicsmagick.org/) (for resizing screenshots)
* [ZeroMQ](http://zeromq.org/) libraries installed
* [Protocol Buffers](https://github.com/google/protobuf) libraries installed
* [yasm](http://yasm.tortall.net/) installed (for compiling embedded [libjpeg-turbo](https://github.com/sorccu/node-jpeg-turbo))
* [pkg-config](http://www.freedesktop.org/wiki/Software/pkg-config/) so that Node.js can find the libraries
* [carthage](https://github.com/Carthage/Carthage)
Note that you need these dependencies even if you've installed STF directly from [NPM](https://www.npmjs.com/), because they can't be included in the package.

On Mac OS, you can use [homebrew](http://brew.sh/) to install most of the dependencies:

```bash
brew install rethinkdb graphicsmagick zeromq protobuf yasm pkg-config carthage
```

## Building

After you've got all the [requirements](#requirements) installed, it's time to fetch the rest of the dependencies.

First, clone stf sources and fetch all NPM and Bower modules.
Note: it is recommended to remove node_modules and res folders before building!

```bash
git clone https://github.com/qaprosoft/stf
cd stf
```

In order to install you have to have xcode cli tool
`sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`

```bash
npm install
#install extra modules
npm i promise
npm i request-promise
npm i websocket-stream
npm i mjpeg-consumer
npm i -g appium
npm i -g wd
```

## WDA Setup 

Only command you need to run
```bash
cd /usr/local/lib/node_modules/appium/node_modules/appium-xcuitest-driver/WebDriverAgent \
    && ./Scripts/bootstrap.sh -d \
    && mkdir -p /usr/local/lib/node_modules/appium/node_modules/node_modules/appium-xcuitest-driver/WebDriverAgent/Resources/WebDriverAgent.bundle
```

If you are using `nvm` the base dir could be difference (like `/Users/yours/.nvm/versions/node/v8.4.0/lib/node_modules/appium/node_modules`)
To check it run `which appium`

Source [Guide](http://appium.io/docs/en/advanced-concepts/wda-custom-server/#wda-setup)

### Build WDA
* You have to add an certificate and provision profile. TODO: describe where you can get them.
* Let's build the ap in XCode: in WebDriverAgent directory run `open WebDriverAgent.xcodeproj`
* Choose profile and hit Build

### Run WDA

* At first connect device to machine where you are going to run WDA.
* To know device ID run it `instruments -s devices`
* To start the service run 
```bash
xcodebuild -project WebDriverAgent.xcodeproj \
    -scheme WebDriverAgentRunner -destination \
    "id=PUT_DEVICE_ID_HERE" USE_PORT=4944 \
    MJEG_SERVER_PORT=7702 test
```

## Link & build

You may also wish to link the module so that you'll be able to access the `stf` command directly from the command line:

```bash
npm link
```

You should now have a working installation for local development.

## Running

If you don't have RethinkDB set up yet, to start it up, go to the folder where you'd like RethinkDB to create a `rethinkdb_data` folder in (perhaps the folder where this repo is) and run the following command:

```bash
rethinkdb
```

_Note: if it takes a long time for RethinkDB to start up, you may be running into [rethinkdb/rethinkdb#4600](https://github.com/rethinkdb/rethinkdb/issues/4600) (or [rethinkdb/rethinkdb#6047](https://github.com/rethinkdb/rethinkdb/issues/6047)). This usually happens on macOS Sierra. To fix this on macOS, first run `scutil --get HostName` to check if the HostName variable is unset. RethinkDB needs it to generate a server name for your instance. If you find that it's empty, running `sudo scutil --set HostName $(hostname)` has been confirmed to fix the issue on at least one occasion. See the issues for more complete solutions._

You should now have RethinkDB running locally. Running the command again in the same folder will reuse the data from the previous session.

TODO: redesign latesr to remove iosdevice.json! Then you should add your devices to the project. Open folder stf and select file iosdevice.json or create your json file where is convenient for you. 

The json file should look like this:

```bash
{
  "udid device" : {
    "ip adress device" : "0.0.0.0",
    "name device" : "come up with a name"
  }
}
```

You're now ready to start up STF itself:

```bash
cd bin
./start-services.sh
./start-provider.sh
```

After the [webpack](http://webpack.github.io/) build process has finished (which can take a small while) you should have your private STF running on [http://localhost:7100](http://localhost:7100). If you had devices connected before running the command, those devices should now be available for use. If not, you should see what went wrong from your console. Feel free to plug in or unplug any devices at any time.

Note that if you see your device ready to use but without a name or a proper image, we're probably missing the data for that model in [our device database](https://github.com/openstf/stf-device-db). Everything should work fine either way.

## License

See [LICENSE](LICENSE).

Copyright © The OpenSTF Project. All Rights Reserved.

[contact-link]: mailto:contact@openstf.io
