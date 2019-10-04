#!/bin/bash

# Example of the ios-device statr script

PUBLIC_IP=stage.qaprosoft.com
PRIVATE_IP=192.168.88.95

# Deckare below variable if STF rethink db is remoted
export RETHINKDB_PORT_28015_TCP="tcp://${PRIVATE_IP}:28015"


# DEVICE NAME    | TYPE      | VERSION| UDID                                     |APPIUM|  WDA  | MJPEG | IWDP  | STF_MIN | STF_MAX | DEVICE IP
# iPhone_7       | phone     | 12.3.1 | 4828ca6492816ddd4996fea31c175f7ab97cbc19 | 4841 | 20001 | 20002 | 20003 |  7701   |  7710   | 192.168.88.14

nohup node /Users/build/tools/stf/lib/cli ios-device --serial 4828ca6492816ddd4996fea31c175f7ab97cbc19 \
        --provider iMac-Developer.local --screen-port 7701 --connect-port 20002 --vnc-port 7732 --public-ip ${PUBLIC_IP} --group-timeout 3600 \
        --storage-url https://${PUBLIC_IP}/ --adb-host 127.0.0.1 --adb-port 5037 --screen-jpeg-quality 40 --screen-ping-interval 30000 \
        --screen-ws-url-pattern ws://${publicIp}:${publicPort} --connect-url-pattern ${publicIp}:${publicPort} --heartbeat-interval 10000 \
        --boot-complete-timeout 60000 --vnc-initial-size 600x800 --mute-master never \
        --connect-app-dealer tcp://${PRIVATE_IP}:7160 --connect-dev-dealer tcp://${PRIVATE_IP}:7260 \
        --wda-host 192.168.88.14 \
        --wda-port 20001 --udid-storage false --iproxy false --connect-sub tcp://${PRIVATE_IP}:7250 --connect-push tcp://${PRIVATE_IP}:7270 --no-cleanup &


