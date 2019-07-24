#!/bin/bash

export RETHINKDB_PORT_28015_TCP="tcp://192.168.88.95:28015"

nohup stf ios-provider --name iMac-Developer.local --min-port=7731 --max-port=7740 --connect-app-dealer tcp://192.168.88.95:7160 --connect-dev-dealer tcp://192.168.88.95:7260 --connect-sub tcp://192.168.88.95:7250 \
	--connect-push tcp://192.168.88.95:7270 --group-timeout 3600 \
	--public-ip stage.qaprosoft.com --storage-url https://stage.qaprosoft.com/ --screen-jpeg-quality 40 --heartbeat-interval 10000 --vnc-initial-size 600x800 \
	--wda-host 192.168.88.78 --wda-port 20031 --mjpeg-port 20032 \
	--udid-storage false --iproxy false \
	--no-cleanup &

#--screen-ws-url-pattern "wss://stage.qaprosoft.com/d/192.168.88.91/b3c999df4a0de71be4fb5878f0df20c25442b883/7702/" &
#--screen-ws-url-pattern "wss://istf.qaprosoft.com/d/192.168.88.91/<%= serial %>/<%= publicPort %>/" &


# stf provider --name "$DEVICEUDID" --min-port=$MIN_PORT --max-port=$MAX_PORT \
#        --connect-sub tcp://$STF_PRIVATE_HOST:$STF_TCP_SUB_PORT --connect-push tcp://$STF_PRIVATE_HOST:$STF_TCP_PUB_PORT \
#        --group-timeout 3600 --public-ip $STF_PUBLIC_HOST --storage-url $WEB_PROTOCOL://$STF_PUBLIC_HOST/ --screen-jpeg-quality 40 \
#        --heartbeat-interval 10000 --vnc-initial-size 600x800 --vnc-port 5900 --no-cleanup --screen-ws-url-pattern "${SOCKET_PROTOCOL}://${STF_PUBLIC_HOST}/d/${STF_PRIVATE_HOST}/<%= serial %>/<%= publicPort %>/" &
