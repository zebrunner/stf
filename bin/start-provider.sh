#!/bin/bash
SCRIPT_PATH="$( cd "$(dirname "$0")" ; pwd -P )"
cd ${SCRIPT_PATH};

PUBLIC_IP=192.168.89.157

nohup stf ios-provider  \
    --name iMac-Developer.local  \
    --min-port 7701 --max-port 7900 \
    --connect-app-dealer tcp://127.0.0.1:7112 \
    --connect-dev-dealer tcp://127.0.0.1:7115 \
    --connect-sub tcp://127.0.0.1:7114 --connect-push tcp://127.0.0.1:7116 \
    --group-timeout 900 --public-ip ${PUBLIC_IP} \
    --storage-url http://localhost:7100/ \
    --adb-host 127.0.0.1 --adb-port 5037 \
    --vnc-initial-size 600x800 --mute-master never  \
    --udid-storage false \
    --iproxy false &
