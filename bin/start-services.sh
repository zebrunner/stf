#!/bin/bash

SCRIPT_PATH="$( cd "$(dirname "$0")" ; pwd -P )"
cd ${SCRIPT_PATH};

PUBLIC_IP=192.168.89.157

ENV_LOCAL=0
MIGRATE=0
while [[ $# -gt 0 ]]; do
    key="$1"

    case $key in
        --local)
        ENV_LOCAL=1
        shift
        ;;
        --migrate)
        MIGRATE=1
        shift
        ;;
    esac
done

if [[ ${ENV_LOCAL} > 0 ]]; then
    mkdir -p "${SCRIPT_PATH}/../data/rethinkdb" && rethinkdb -d "${SCRIPT_PATH}/../data/rethinkdb" --daemon

    if [[ ${MIGRATE} > 0 ]]; then
        stf migrate
    fi;
fi;

stf triproxy app001 --bind-pub tcp://127.0.0.1:7111 --bind-dealer tcp://127.0.0.1:7112 --bind-pull tcp://127.0.0.1:7113 &
stf triproxy dev001 --bind-pub tcp://127.0.0.1:7114 --bind-dealer tcp://127.0.0.1:7115 --bind-pull tcp://127.0.0.1:7116 &

stf processor proc001 \
    --connect-app-dealer tcp://127.0.0.1:7112 \
    --connect-dev-dealer tcp://127.0.0.1:7115 \
    --public-ip ${PUBLIC_IP} \
    --connect-push tcp://127.0.0.1:7116 &

stf reaper reaper001 --connect-push tcp://127.0.0.1:7116 --connect-sub tcp://127.0.0.1:7111 &

stf auth-mock --port 7120 --secret kute kittykat --app-url http://${PUBLIC_IP}:7100/ &

stf app --port 7105 --secret kute kittykat \
    --auth-url http://${PUBLIC_IP}:7100/auth/mock/ \
    --websocket-url http://${PUBLIC_IP}:7110/ &

stf api --port 7106 --secret kute kittykat \
    --connect-push tcp://127.0.0.1:7113 \
    --connect-sub tcp://127.0.0.1:7111 &

stf websocket --port 7110 --secret kute kittykat \
    --storage-url http://localhost:7100/ \
    --connect-sub tcp://127.0.0.1:7111 \
    --connect-push tcp://127.0.0.1:7113 &

stf storage-temp --port 7102 \
    --connect-push tcp://127.0.0.1:7116 \
    --connect-sub tcp://127.0.0.1:7407 &

stf storage-plugin-image --port 7103 \
    --storage-url http://localhost:7100/ &

stf storage-plugin-apk --port 7104 \
    --storage-url http://localhost:7100/ &

stf poorxy --port 7100 \
    --app-url http://localhost:7105/ \
    --auth-url http://localhost:7120/ \
    --api-url http://localhost:7106/ \
    --websocket-url http://localhost:7110/ \
    --storage-url http://localhost:7102/ \
    --storage-plugin-image-url http://localhost:7103/ \
    --storage-plugin-apk-url http://localhost:7104/ &

