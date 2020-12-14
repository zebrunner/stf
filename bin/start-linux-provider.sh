#!/bin/bash

# Example of the android-device stf provider start script

PUBLIC_IP=stage.qaprosoft.com
PRIVATE_IP=192.168.88.95

# Deckare below variable if STF rethink db is remoted
export RETHINKDB_PORT_28015_TCP="tcp://${PRIVATE_IP}:28015"


nohup node stf provider --name MYNAME --min-port=7701 --max-port=7710 \
  --connect-sub tcp://${PRIVATE_IP}:7250 --connect-push tcp://${PRIVATE_IP}:7270 \
  --group-timeout 3600 --public-ip ${PUBLIC_IP} --storage-url https://${PUBLIC_IP}/ \
  --screen-jpeg-quality 40 --heartbeat-interval 10000 --vnc-initial-size 600x800 --vnc-port 5900 \
  --no-cleanup --screen-ws-url-pattern wss://${PUBLIC_IP}/d/MYNAME/<%= serial %>/<%= publicPort %>/ &
