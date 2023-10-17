SmartTestFarm
==================

Feel free to support the development with a [**donation**](https://www.paypal.com/donate?hosted_button_id=JLQ4U468TWQPS) for the next improvements.

<p align="center">
  <a href="https://zebrunner.com/"><img alt="Zebrunner" src="https://github.com/zebrunner/zebrunner/raw/master/docs/img/zebrunner_intro.png"></a>
</p>

**STF** (or Smartphone Test Farm) is a web application for debugging smartphones, smartwatches and other gadgets remotely, from the comfort of your browser.
## Disclaimer
Current project <b>must be deployed only</b> as part of [Zebrunner CE](https://github.com/zebrunner/community-edition) or [MCloud](https://github.com/zebrunner/mcloud) solutions!

## Overview

![Close-up of device shelf](https://raw.githubusercontent.com/DeviceFarmer/stf/master/doc/shelf_closeup_790x.jpg)

![Super short screencast showing usage](https://raw.githubusercontent.com/DeviceFarmer/stf/master/doc/7s_usage.gif)

## Contributors
Thank you to all the people who have already contributed to STF!
<a href = "https://github.com/devicefarmer/stf/graphs/contributors">
  <img src = "https://contrib.rocks/image?repo=devicefarmer/stf"/>
</a>

## Features

* OS support
  - Android
    * Supports versions 2.3.3 (SDK level 10) to 12 (SDK level 32)
    * Supports Wear 5.1 (but not 5.0 due to missing permissions)
    * Supports Fire OS, CyanogenMod, and other heavily Android based distributions
    * `root` is **not** required for any current functionality
* Remote control any device from your browser
  - Real-time screen view
    * Refresh speed can reach 30-40 FPS depending on specs and Android version. See [minicap](https://github.com/devicefarmer/minicap) for more information.
    * Rotation support
  - Supports typing text from your own keyboard
    * Supports meta keys
    * Copy and paste support (although it can be a bit finicky on older devices, you may need to long-press and select paste manually)
    * May sometimes not work well with non-Latin languages unfortunately.
  - Multitouch support on touch screens via [minitouch](https://github.com/devicefarmer/minitouch), two finger pinch/rotate/zoom gesture support on regular screens by pressing `Alt` while dragging
  - Drag & drop installation and launching of `.apk` files
    * Launches main launcher activity if specified in the manifest
  - Reverse port forwarding via [minirev](https://github.com/devicefarmer/minirev)
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
* Monitor your device inventory
  - See which devices are connected, offline/unavailable (indicating a weak USB connection), unauthorized or unplugged
  - See who's using a device
  - Search devices by phone number, IMEI, ICCID, Android version, operator, product name, group name and/or many other attributes with easy but powerful queries
  - Show a bright red screen with identifying information on a device you need to locate physically
  - Track battery level and health
  - Rudimentary Play Store account management
    * List, remove and add new accounts (adding may not work on all devices)
  - Display hardware specs
* Use the Booking & Partitioning systems
  - Overview
    * The partitioning system allow you `[administrator level]` to allocate distinct sets of devices to different projects or organizations (i.e. represented by user sets) for an unlimited period
    * The booking system allows you to reserve a set of devices for a set of users during a limited time (e.g. from 3:00 am to 4:00 am during 5 days)
    * What is common to the booking & partitioning systems is the concept of Group, that is, an association of devices, users and a specification of time
    * Report to [GroupFeature.pdf](doc/GroupFeature.pdf) for detailed documentation on how to use this feature
  - Monitor your group inventory
    * See which groups are active, ready or pending, as well as other group properties: name, identifier, owner, devices, users, class, duration, repetition, starting date, expiration date
    * Search groups by their property values
    * Contact by email the owners of the selected groups 
  - Manage your groups
    * Create a group by specifying its name, devices, users and schedule
    * Get ready your group in order it is scheduled by the system
    * Search groups by their property values
    * Remove your group or a selection of your groups
    * Contact by email the owners of the selected groups `[administrator level]`
* Manage the devices `[administrator level]`
  - Search the devices by their property values
  - Remove a  device or a selection of devices meeting a set of filters: present, booked, annotated, controlled
* Manage the users `[administrator level]`
  - Create a user by providing his name and his email
  - Search the users by their property values
  - Remove a user or a selection of users meeting a set of filters: group owner
  - Contact a user or a selection of users by email
  - Set the default groups quotas applicable to all users
  - Set the groups quotas applicable to a specific user
* Simple REST [API](doc/API.md)

## Status

STF is in continued, active development, but development is still largely funded by individual team members and their unpaid free time, leading to slow progress. While normal for many open source projects, STF is quite heavy on the hardware side, and is therefore somewhat of a money sink.

We're also actively working to expand the team, don't be afraid to ask if you're interested.

### Short term goals

Here are some things we are planning to address ASAP.

1. Performance
2. Properly expose the new VNC functionality in the UI
3. Properly reset user data between uses (Android 4.0+)
4. Automated scheduled restarts for devices

### Long term goals

1. iOS support

## A quick note about security

As the product has evolved from an internal tool running in our internal network, we have made certain assumptions about the trustworthiness of our users. As such, there is little to no security or encryption between the different processes. Furthermore, devices do not get completely reset between uses, potentially leaving accounts logged in or exposing other sensitive data. This is not an issue for us, as all of our devices are test devices and are only used with test accounts, but it may be an issue for you if you plan on deploying STF to a multiuser environment. We welcome contributions in this area.

## Requirements

* [Node.js](https://nodejs.org/) up to 20.x **required** (some dependencies don't support newer versions)
* [ADB](http://developer.android.com/tools/help/adb.html) properly set up
* [RethinkDB](http://rethinkdb.com/) >= 2.2
* [CMake](https://cmake.org/) >= 3.9 (for [node-jpeg-turbo](https://github.com/julusian/node-jpeg-turbo#readme))
* [GraphicsMagick](http://www.graphicsmagick.org/) (for resizing screenshots)
* [ZeroMQ](http://zeromq.org/) libraries installed
* [Protocol Buffers](https://github.com/google/protobuf) libraries installed
* [yasm](http://yasm.tortall.net/) installed (for compiling embedded [libjpeg-turbo](https://github.com/devicefarmer/node-jpeg-turbo))
* [pkg-config](http://www.freedesktop.org/wiki/Software/pkg-config/) so that Node.js can find the libraries

Note that you need these dependencies even if you've installed STF directly from [NPM](https://www.npmjs.com/), because they can't be included in the package.

On Mac OS, you can use [homebrew](http://brew.sh/) to install most of the dependencies:

```bash
brew install rethinkdb graphicsmagick zeromq protobuf yasm pkg-config cmake
```

On Windows you're on your own. In theory you might be able to get STF installed via [Cygwin](https://www.cygwin.com/) or similar, but we've never tried. In principle we will not provide any Windows installation support, but please do send a documentation pull request if you figure out what to do.

We also provide a [Docker](http://docker.com/) container in the [Docker Hub](https://hub.docker.com/) as [devicefarmer/stf](https://hub.docker.com/r/devicefarmer/stf). You can use our [Dockerfile](Dockerfile) as guidance if you'd prefer to do the installation yourself.
An example standalone [docker-compose.yaml](docker-compose.yaml) file is also provided.

You should now be ready to [build](#building) or [run](#running) STF.

Note that while Mac OS can be used for development, it doesn't provide a very reliable experience in production due to (presumed) bugs in ADB's Mac OS implementation. We use [CoreOS](https://coreos.com/) but any Linux or BSD distribution should do fine.

## Installation

As mentioned earlier, you must have all of the [requirements](#requirements) installed first. Then you can simply install via NPM:

```bash
npm install -g @devicefarmer/stf
```

Now you're ready to [run](#running). For development, though, you should [build](#building) instead.

## Building

After you've got all the [requirements](#requirements) installed, it's time to fetch the rest of the dependencies.

First, fetch all NPM and Bower modules:

```bash
npm install
```

You may also wish to link the module so that you'll be able to access the `stf` command directly from the command line:

```bash
npm link
```

You should now have a working installation for local development.

## Running

STF comprises of several independent processes that must normally be launched separately. In our own setup each one these processes is its own [systemd](http://www.freedesktop.org/wiki/Software/systemd/) unit. See [DEPLOYMENT.md](doc/DEPLOYMENT.md) and [Setup Examples](https://github.com/devicefarmer/setup-examples) if you're interested.

For development purposes, however, there's a helper command to quickly launch all required processes along with a mock login implementation. Note that you **must** have RethinkDB running first.

If you don't have RethinkDB set up yet, to start it up, go to the folder where you'd like RethinkDB to create a `rethinkdb_data` folder in (perhaps the folder where this repo is) and run the following command:

```bash
rethinkdb
```

_Note: if it takes a long time for RethinkDB to start up, you may be running into [rethinkdb/rethinkdb#4600](https://github.com/rethinkdb/rethinkdb/issues/4600) (or [rethinkdb/rethinkdb#6047](https://github.com/rethinkdb/rethinkdb/issues/6047)). This usually happens on macOS Sierra. To fix this on macOS, first run `scutil --get HostName` to check if the HostName variable is unset. RethinkDB needs it to generate a server name for your instance. If you find that it's empty, running `sudo scutil --set HostName $(hostname)` has been confirmed to fix the issue on at least one occasion. See the issues for more complete solutions._

You should now have RethinkDB running locally. Running the command again in the same folder will reuse the data from the previous session.

An administrator level is available in STF in addition of the native user one, with increased rights on some features (e.g.  booking & partitioning systems, management of users & devices, ...). The corresponding built-in administrator user has the following default credentials:
- name: `administrator`
- email: `administrator@fakedomain.com`

Another built-in object exists, this is the root standard group to which the users and devices belong the first time they register to the STF database, its default name is `Common`

These built-in objects are created in the STF database if they do not already exist 

Of course, you can override the default values of these built-in objects by settings the following environment variables before to initialize the STF database through `stf local` or `stf migrate` commands:
-	root standard group name: `STF_ROOT_GROUP_NAME` 
-	administrator user name: `STF_ADMIN_NAME`
-	administrator user email: `STF_ADMIN_EMAIL`

You're now ready to start up STF itself:

```bash
stf local
```

After the [webpack](http://webpack.github.io/) build process has finished (which can take a small while) you should have your private STF running on [http://localhost:7100](http://localhost:7100). If you had devices connected before running the command, those devices should now be available for use. If not, you should see what went wrong from your console. Feel free to plug in or unplug any devices at any time.

Note that if you see your device ready to use but without a name or a proper image, we're probably missing the data for that model in [our device database](https://github.com/devicefarmer/stf-device-db). Everything should work fine either way.

If you want to access STF from other machines, you can add the `--public-ip` option for quick testing.

```bash
stf local --public-ip <your_internal_network_ip_here>
```

## Updating

To update your development version, simply pull the repo and run `npm install` again. You may occasionally have to remove the whole `node_modules` and `res/bower_components` folder to prevent NPM or Bower from complaining about version mismatches.

## FAQ

### Can I deploy STF to actual servers?

Yes, see [DEPLOYMENT.md](doc/DEPLOYMENT.md) and [Setup Examples](https://github.com/devicefarmer/setup-examples).

### Will I have to change battery packs all the time?

No, not all the time. Aside from a single early failure we had within only a few months, all of our devices were doing fine for about two years. However, having reached the 2-3 year mark, several devices have started to experience visibly expanded batteries. Expanded batteries should be replaced as soon as possible. Note that this issue isn't specific to STF, it's just what happens over time. You should be prepared to replace the batteries every now and then. In any case, we consider 2 years per battery pack to be fairly good value for a device lab.

You should set up your devices so that the display is allowed to turn off entirely after a short timeout. 30 seconds or so should do just fine, STF will wake it up when necessary. Otherwise you risk reducing the lifetime of your device.

Note that you may have a problem if your USB hubs are unable to both provide enough power for charging and support a data connection at the same time (data connections require power, too). This can cause a device to stop charging when being used, resulting in many charging cycles. If this happens you will just need to [get a better USB hub](#recommended-hardware).

### Is the system secure?

It's possible to run the whole user-facing side behind HTTPS, but that's pretty much it. All internal communication between processes is insecure and unencrypted, which is a problem if you can eavesdrop on the network. See our [quick note about security](#a-quick-note-about-security).

### Can I just put the system online, put a few devices there and start selling it?

Yes and no. See "[Is the system secure?](#is-the-system-secure)". The system has been built in an environment where we are able to trust our users and be confident that they're not going to want to mess with others. In the current incarnation of the system a malicious user with knowledge of the inner workings will, for instance, be able to control any device at any time, whether it is being used by someone or not. Pull requests are welcome.

### Once I've got the system running, can I pretty much leave it like that or is manual intervention required?

In our experience the system runs just fine most of the time, and any issues are mostly USB-related. You'll usually have to do something about once a week.

The most common issue is that a device will lose all of its active USB connections momentarily. You'll get errors in the logs but the worker process will either recover or get respawned, requiring no action on your side.

Below are the most common errors that do require manual intervention.

* One device worker keeps getting respawned all the time
  - Rebooting the device usually helps. If the device stays online for long enough you might be able to do it from the UI. Otherwise you'll have to SSH into the server and run `adb reboot` manually.
  - This could be a sign that you're having USB problems, and the device wishes to be moved elsewhere. The less complex your setup is the fewer problems you're going to experience. See [troubleshooting](#troubleshooting).
  - We're working on adding periodic automatic restarts and better graceful recovery to alleviate the issue.
* A whole group of devices keeps dying at once
  - They're most likely connected to the same USB hub. Either the hub is bad or you have other compatibility issues. In our experience this usually happens with USB 3.0 hubs, or you may have a problem with your USB extension card. See [recommended hardware](#recommended-hardware).
* A device that should be online is not showing up in the list or is showing up as disconnected
  - See [troubleshooting](#troubleshooting).

### How do I uninstall STF from my device?

When you unplug your device, all STF utilities except STFService stop running automatically. It doesn't do any harm to force stop or uninstall it.

To uninstall the STFService, run the following command:

```bash
adb uninstall jp.co.cyberagent.stf
```

You may also wish to remove our support binaries, although as mentioned before they won't run unless the device is actually connected to STF. You can do this as follows:

```bash
adb shell rm /data/local/tmp/minicap \
  /data/local/tmp/minicap.so \
  /data/local/tmp/minitouch \
  /data/local/tmp/minirev
```

Your device is now clean.

## Troubleshooting

### I plugged in a new device but it's not showing up in the list.

There can be various reasons for this behavior. Some especially common reasons are:

* USB debugging is not enabled
  - Enable it.
* USB debugging is enabled but the USB connection mode is wrong
  - Try switching between MTP and PTP modes and see if the device appears. This happens fairly often on Mac OS but almost never on Linux.
* You don't have the ADB daemon running
  - Make sure ADB is running with `adb start-server`.
* You haven't authorized the ADB key yet
  - Check your device for an authentication dialog. You may need to unplug and then plug the device back in to see the dialog.
* ADB hasn't whitelisted the manufacturer's vendor ID
  - [Add it yourself](https://github.com/apkudo/adbusbini) or wait for the new version that removes the stupid whitelisting feature to be deployed.
* Insufficient power supply
  - If you're using a USB hub, try a [powered hub](#recommended-hardware) instead (one that comes with a separate AC adapter).
  - Even if you're using a powered hub, there might not actually be enough power for all ports simultaneously. [Get a better hub](#recommended-hardware) or use fewer ports.
  - Your device is too power hungry, can happen with tablets. [Get a better hub](#recommended-hardware).
* Insufficient USB host controller resources
  - On Linux, use `dmesg` to check for this error
  - If you've only got 9-12 devices connected and an Intel (Haswell) processor, it's most likely an issue with the processor. If your BIOS has an option to disable USB 3.0, that might help. If not, you're screwed and must get a PCIE extension card with onboard controllers.
* Your powered USB hub does not support the device
  - Can happen with older devices and newer Battery Charging spec compatible hubs. [Get a more compatible hub](#recommended-hardware).
* The USB cable is bad
  - It happens. Try another one.
* The USB hub is broken
  - This, too, happens. Just try a new one.
* The device might not have a unique USB serial number, causing STF to overwrite the other device instead
  - This has never happened to us so far, but we do have one dirt-cheap Android 4.4 device whose serial number is the wonderfully unique "0123456789ABCDEF". Presumably if we had more than one unit we would have a problem.

### A device that was previously connected no longer shows up in the list.

Again, there can be various reasons for this behavior as well. Some common reasons are:

* The device ran out of power
  - You can see the last reported power level in the device list, unless there was a lengthy power outage preventing the battery level from being reported.
* Someone accidentally disabled USB debugging remotely
  - Yes, it happens.
* An OS update disabled USB debugging
  - Yes, it happens. Especially on Fire OS.
* Someone touched the USB cable just the wrong way causing a disconnection
  - Happens easily.
* Your PCIE USB extension card died
  - Yes, it happens.
* Temporary network issues
  - Can't help with that.
* Someone removed the device physically.
  - Or that.
* You're on Mac OS
  - There's a bug in ADB's Mac OS implementation that causes devices to be lost on error conditions. The problem is more pronounced when using USB hubs. You have to unplug and then plug it back in again.
* The USB hub broke
  - Happens. Just try a new one.

### Remote debugging (i.e. `adb connect`) disconnects while I'm working.

If you're using STF locally, the most common cause is that you're not filtering the devices STF is allowed to connect to. The problem is that once you do `adb connect`, STF sees a new device and tries to set it up. Unfortunately since it's already connected via USB, setting up the new device causes the worker process handling the original USB device to fail. This is not a problem in production, since the devices should be connected to an entirely different machine anyway. For development it's a bit inconvenient. What you can do is give `stf local` a list of serials you wish to use. For example, if your device's serial is `0123456789ABCDEF`, use `stf local 0123456789ABCDEF`. Now you can use `adb connect` and STF will ignore the new device.

There's another likely cause if you're running STF locally. Even if you whitelist devices by serial in STF, your IDE (e.g. Android Studio) doesn't know anything about that. From the IDE's point of view, you have two devices connected. When you try to run or debug your application, Android Studio suddenly notices that two devices are now providing JDWP connections and tries to connect to them both. This doesn't really work since the debugger will only allow one simultaneous connection, which causes problems with ADB. It then decides to disconnect the device (or sometimes itself) entirely.

One more sad possibility is that your Android Studio likes to restart ADB behind the scenes. Even if you restart ADB, USB devices will soon reappear as they're still connected. The same is not true for remote devices, as ADB never stores the list anywhere. This can sometimes also happen with the Android Device Monitor (`monitor`).

## Recommended hardware

This is a list of components we are currently using and are proven to work.

### PC components

These components are for the PC where the USB devices are connected. Our operating system of choice is [CoreOS](https://coreos.com/), but any other Linux or BSD distribution should do fine. Be sure to use reasonably recent kernels, though, as they often include improvements for the USB subsystem.

Our currently favorite build is as follows. It will be able to provide 28 devices using powered USB hubs, and about 10 more if you're willing to use the motherboard's USB ports, which is usually not recommended for stability reasons. Note that our component selection is somewhat limited by their availability in Japan.

| Component | Recommendation | How many |
|-----------|------|----------|
| PC case | [XIGMATEK Nebula](http://www.xigmatek.com/product.php?productid=219) | x1 |
| Motherboard | [ASUS H97I-PLUS](https://www.asus.com/Motherboards/H97IPLUS/) | x1 |
| Processor | [Intel® Core™ i5-4460](http://ark.intel.com/products/80817/Intel-Core-i5-4460-Processor-6M-Cache-up-to-3_40-GHz) | x1 |
| PSU | [Corsair CX Series™ Modular CX430M ATX Power Supply](http://www.corsair.com/en/cx-series-cx430m-modular-atx-power-supply-430-watt-80-plus-bronze-certified-modular-psu) | x1 |
| Memory | Your favorite DDR3 1600 MHz 8GB stick | x1 |
| SSD | [A-DATA Premier Pro SP900 64GB SSD](http://www.adata.com/en/ssd/specification/171) | x1 |
| USB extension card | [StarTech.com 4 Port PCI Express (PCIe) SuperSpeed USB 3.0 Card Adapter w/ 4 Dedicated 5Gbps Channels - UASP - SATA / LP4 Power](http://www.startech.com/Cards-Adapters/USB-3.0/Cards/PCI-Express-USB-3-Card-4-Dedicated-Channels-4-Port~PEXUSB3S44V) | x1 |
| USB hub | [Plugable USB 2.0 7 Port Hub with 60W Power Adapter](http://plugable.com/products/usb2-hub7bc) | x4 |
| MicroUSB cable | [Monoprice.com 1.5ft USB 2.0 A Male to Micro 5pin Male 28/24AWG Cable w/ Ferrite Core (Gold Plated)](http://www.monoprice.com/Product?c_id=103&cp_id=10303&cs_id=1030307&p_id=5456&seq=1&format=2) | x28 |

You may also need extension cords for power.

Alternatively, if you find that some of your older devices [do not support the recommended hub](#troubleshooting), you may wish to mix the hub selection as follows:

| Component | Recommendation | How many |
|-----------|------|----------|
| USB hub | [Plugable USB 2.0 7 Port Hub with 60W Power Adapter](http://plugable.com/products/usb2-hub7bc) | x2 |
| USB hub for older devices | [System TALKS USB2-HUB4XA-BK](http://www.system-talks.co.jp/product/sgc-4X.htm) | x2-4 |

You can connect up to two of the older hubs (providing up to 8 devices total) directly to the motherboard without exhausting USB host controller resources.

We also have several "budget builds" with an [MSI AM1I](http://www.msi.com/product/mb/AM1I.html#hero-overview) motherboard and an [AMD Athlon 5350 4-core processor](http://www.amd.com/en-gb/products/processors/desktop/athlon). These builds, while significantly cheaper, sometimes completely lose the USB PCIE extension cards, and even a reboot will not always fix it. This may normally be fixable via BIOS USB settings, but unfortunately the budget motherboard has a complete lack of any useful options. Fortunately the AMD processor does not share Intel's Haswell [USB host control resource problem](#troubleshooting), so you can also just connect your hubs to the motherboard directly if you don't mind sharing the root bus.

Below is an incomplete list of some of the components we have tried so far, including unsuitable ones.

#### Tested equipment

_Note that our hardware score ratings only reflect their use for the purposes of this project, and are not an overall statement about the quality of the product._

##### USB extension cards

| Name | Score | Short explanation |
|------|-------|-------------------|
| [StarTech.com 4 Port PCI Express (PCIe) SuperSpeed USB 3.0 Card Adapter w/ 4 Dedicated 5Gbps Channels - UASP - SATA / LP4 Power](http://www.startech.com/Cards-Adapters/USB-3.0/Cards/PCI-Express-USB-3-Card-4-Dedicated-Channels-4-Port~PEXUSB3S44V) | 9/10 | Reliable, well supported chipset and good power connections |
| [StarTech.com 4 Independent Port PCI Express USB 2.0 Adapter Card](http://www.startech.com/Cards-Adapters/USB-2/Card/4-Independent-Port-PCI-Express-USB-Card~PEXUSB400) | 8/10 | Reliable |
| [玄人志向 USB3.0RX4-P4-PCIE](http://www.kuroutoshikou.com/product/interface/usb/usb3_0rx4-p4-pcie/) | 4/10 | Well supported chipset but breaks VERY easily |

Our current recommendation is [StarTech.com's PEXUSB3S44V](http://www.startech.com/Cards-Adapters/USB-3.0/Cards/PCI-Express-USB-3-Card-4-Dedicated-Channels-4-Port~PEXUSB3S44V). It provides an independent Renesas (allegedly Linux-friendliest) µPD720202 host controller for each port. Another option from the same maker is [PEXUSB400](http://www.startech.com/Cards-Adapters/USB-2/Card/4-Independent-Port-PCI-Express-USB-Card~PEXUSB400), which also works great but may offer slightly less future proofing.

Our [玄人志向 USB3.0RX4-P4-PCIE](http://www.kuroutoshikou.com/product/interface/usb/usb3_0rx4-p4-pcie/) cards have been nothing but trouble and we've mostly phased them out by now. Chipset-wise it's pretty much the same thing as StarTech's offering, but the SATA power connector is awfully flimsy and can actually physically break off. The card is also incredibly sensitive to static electricity and will permanently brick itself, which happened on numerous occasions.

##### USB hubs

| Name | Score | Short explanation |
|------|-------|-------------------|
| [Plugable USB 2.0 7 Port Hub with 60W Power Adapter](http://plugable.com/products/usb2-hub7bc) | 8/10 | High power output, high reliability |
| [Plugable USB 3.0 7-port Charging Hub with 60W Power Adapter](http://plugable.com/products/usb3-hub7bc) | 5/10 | High power output, low reliability |
| [System TALKS USB2-HUB4XA-BK USB 2.0 hub with power adapter](http://www.system-talks.co.jp/product/sgc-4X.htm) | 7/10 | High power output on two ports which complicates device positioning, low port count |
| [Anker USB 3.0 9-Port Hub + 5V 2.1A Charging Port](http://www.ianker.com/product/68ANHUB-B10A) | 2/10 | High port count, insufficient power |
| [ORICO P10-U2 External ABS 10 Port 2.0 USB HUB for Laptop/Desktop-BLACK](http://www.aliexpress.com/store/product/Orico-p10-u2-computer-usb-hub-usb-splitter-10-usb-hub-interface/105327_1571541943.html) | 3/10 | High port count, insufficient power |
| [ORICO BH4-U3-BK ABS 4 Port USB3.0 BC1.2 Charging HUB with 12V3A Power Adapter-BLACK](http://www.aliexpress.com/store/product/ORICO-BH4-U3-BK-ABS-4-Port-USB3-0-BC1-2-Charging-HUB-with-12V3A-Power/105327_2035899542.html) | 5/10 | High power output, low reliability |

The best hub we've found so far is Plugable's [USB 2.0 7 Port Hub with 60W Power Adapter](http://plugable.com/products/usb2-hub7bc). It's able to provide 1.5A per port for Battery Charging spec compliant devices, which is enough to both charge and sync even tablets (although charging will not occur at maximum speed, but that's irrelevant to us). Note that even devices that are not compliant will usually charge and sync just fine, albeit slower. The more recent USB 3.0 version has proven unreliable with the rest of our components, causing the whole hub to disconnect at times. Annoyingly the ports face the opposite direction, too. Note that ORICO also provides hubs that are identical to Plugable's offerings, the latter of which seem to be rebrands.

Unfortunately Plugable's USB 2.0 hub is not perfect either, at least for our purposes. It includes a physical on/off switch which can be especially annoying if your devices are in a regular office with occasional scheduled power outages. This will shut down the PC too, of course, but the problem is that once power comes back online, the hubs will be unable to switch themselves on and the devices won't charge, leading you to find a bunch of dead devices the next Monday.

The System TALKS USB 2.0 hub is very reliable, but has a few annoying drawbacks. First, the power adapter only provides power to two of its four ports, while the other two are powered by the host PC. The problem with this approach is that you must figure out which devices are power hungry yourself and put them on the ports with higher current. This can complicate device setup/positioning quite a bit. Another drawback is that if the host PC is turned off, only the powered ports will keep charging the connected devices. However, the hub is amazingly compatible with pretty much anything, making it the top choice for older devices that do not support the Battery Charging hubs.

Most powered USB 3.0 hubs we've tested have had a serious problem: the whole hub occasionally disconnected. This may have been caused by the specific combination of our components and/or OS, but as of yet we don't really know. Disabling USB 3.0 may help if you run into the same problem.

## Translating

Currently STF UI is available in English and Japanese.

If you would like translate to any other language, please contribute in the [STF Transifex project](https://www.transifex.com/devicefarmer/stf-main).

For updating the source and all the translation files first you have to install the [Transifex client](http://docs.transifex.com/client/setup/).

Then just run:
```bash
gulp translate
```

It will do the following:

1. Convert all the `jade` files to `html`.
2. Extract with gettext all translatable strings to `stf.pot`.
3. Push `stf.pot` to Transifex.
4. Pull from Transifex all `po` translations.
5. Compile all `po` files to `json`.

Then in order to add it officially (only needs to be done once):

1. Add the language to `res/common/lang/langs.json`.
2. Pull the specific language `tx pull -l <lang>`.
3. Run `gulp translate`.

## Testing

See [TESTING.md](TESTING.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## History

Project was previously developed as [OpenSTF](https://github.com/openstf) and supported by [CyberAgent](https://www.cyberagent.co.jp/en/), [HeadSpin](https://performance.headspin.io/) and [other individual contributors](https://opencollective.com/openstf).

See [Credits](doc/CREDITS.md) for more details.

### DeviceFarmer vs OpenSTF FAQ

#### What exactly has changed?

1. Organisation on GitHub to [DeviceFarmer](https://github.com/DeviceFarmer)
1. Organisation on DockerHub to [devicefarmer](https://hub.docker.com/orgs/devicefarmer)
1. Package coordinates on npmjs are now under [@devicefarmer scope](https://www.npmjs.com/package/@devicefarmer/stf)

#### How to migrate?

It depends on how you are using STF. One or more of those changes may be needed:

* change Docker image coordinates eg. `docker pull openstf/stf` to `docker pull devicefarmer/stf`
* change npmjs package coordinates eg. `npm install -g stf` to `npm install -g @devicefarmer/stf`

#### Will version OpenSTF 3.4.2 be published to npmjs?

No. Exceptionally, on npmjs the last OpenSTF version is 3.4.1.

#### What about sponsorship?

DeviceFarmer team have no access to OpenSTF donations collected using [Open Collective](https://opencollective.com/openstf). At the time of writing DeviceFarmer do not collect any donations.

## License

See [LICENSE](LICENSE).

Copyright © 2017 The OpenSTF Project. All Rights Reserved.

Project is a part of [OW2 consortium](https://projects.ow2.org/view/devicefarmer/).
