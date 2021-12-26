#!/bin/bash

echo "[$(date +'%d/%m/%Y %H:%M:%S')] populating device info"
PLATFORM_VERSION=$(ios info --udid=$DEVICE_UDID | jq -r ".ProductVersion")
  # TODO: detect tablet and TV for iOS, also review `ios info` output data like below
    #"DeviceClass":"iPhone",
    #"ProductName":"iPhone OS",
    #"ProductType":"iPhone10,5",
    #"ProductVersion":"14.7.1",
    #"SerialNumber":"C38V961BJCM2",
    #"TimeZone":"Europe/Minsk",
    #"TimeZoneOffsetFromUTC":10800,


# https://github.com/zebrunner/stf/issues/256
echo "[$(date +'%d/%m/%Y %H:%M:%S')] Pair device $DEVICE_UDID"
ios pair --udid=$DEVICE_UDID


#echo "[$(date +'%d/%m/%Y %H:%M:%S')] Allow to download DeveloperDiskImages automatically"
#ios image auto --basedir /opt/zebrunner/DeveloperDiskImages
echo "[$(date +'%d/%m/%Y %H:%M:%S')] Mount /opt/zebrunner/DeveloperDiskImages/$PLATFORM_VERSION/DeveloperDiskImage.dmg"
ios image mount --path=/opt/zebrunner/DeveloperDiskImages/$PLATFORM_VERSION/DeveloperDiskImage.dmg --udid=$DEVICE_UDID

echo "[$(date +'%d/%m/%Y %H:%M:%S')] Installing WDA application on device"
ios install --path=/opt/WebDriverAgent.ipa --udid=$DEVICE_UDID

# no need to launch springboard as it is already started. below command doesn't activate it!
#echo "[$(date +'%d/%m/%Y %H:%M:%S')] Activating default com.apple.springboard during WDA startup"
#ios launch com.apple.springboard

echo "[$(date +'%d/%m/%Y %H:%M:%S')] Starting WebDriverAgent application on port $WDA_PORT"
ios runwda --bundleid=$WDA_BUNDLEID --testrunnerbundleid=$WDA_BUNDLEID --xctestconfig=WebDriverAgentRunner.xctest --env USE_PORT=$WDA_PORT --env MJPEG_SERVER_PORT=$MJPEG_PORT --env UITEST_DISABLE_ANIMATIONS=YES --udid $DEVICE_UDID > ${WDA_LOG_FILE} 2>&1 &

#Start the WDA service on the device using the WDA bundleId
ip=""
#Parse the device IP address from the WebDriverAgent logs using the ServerURL
#We are trying several times because it takes a few seconds to start the WDA but we want to avoid hardcoding specific seconds wait

echo detecting WDA_HOST ip address...
for ((i=1; i<=$WDA_WAIT_TIMEOUT; i++))
do
 if [ -z "$ip" ]
  then
   #{"level":"info","msg":"2021-12-08 19:26:18.502735+0300 WebDriverAgentRunner-Runner[8680:8374823] ServerURLHere-\u003ehttp://192.168.88.155:8100\u003c-ServerURLHere\n","time":"2021-12-08T16:26:18Z"}
   ip=`grep "ServerURLHere-" ${WDA_LOG_FILE} | cut -d ':' -f 7`
   WDA_PORT=`grep "ServerURLHere-" ${WDA_LOG_FILE} | cut -d ':' -f 8 | cut -d '\' -f 1`
   echo "attempt $i"
   sleep 1
  else
   break
 fi
done

if [[ -z $ip ]]; then
  echo "ERROR! Unable to parse WDA_HOST ip from log file!"
  cat $WDA_LOG_FILE
  # Below exit completely destroy appium container as there is no sense to continue with undefined WDA_HOST ip!
  exit -1
fi

export WDA_HOST="${ip//\//}"
echo "Detected WDA_HOST ip: ${WDA_HOST}"
echo "WDA_PORT=${WDA_PORT}"


echo "WDA_HOST=${WDA_HOST}" > ${WDA_ENV}
echo "WDA_PORT=${WDA_PORT}" >> ${WDA_ENV}
echo "MJPEG_PORT=${MJPEG_PORT}" >> ${WDA_ENV}
echo "PLATFORM_VERSION=${PLATFORM_VERSION}" >> ${WDA_ENV}


# #247: right after the WDA startup it should load SNAPSHOT of com.apple.springboard default screen and default timeout is 60 sec for 1st start.
# We have to start this session at once and till next restart WDA sessions might be stopped/started asap.
echo "[$(date +'%d/%m/%Y %H:%M:%S')] Starting WebDriverAgent 1st session"
# start new WDA session with default 60 sec snapshot timeout
sessionFile=/tmp/${DEVICE_UDID}.txt
curl --silent --location --request POST "http://${WDA_HOST}:${WDA_PORT}/session" --header 'Content-Type: application/json' --data-raw '{"capabilities": {"waitForQuiescence": false}}' > ${sessionFile}

bundleId=`cat $sessionFile | grep "CFBundleIdentifier" | cut -d '"' -f 4`
echo bundleId: $bundleId

sessionId=`cat $sessionFile | grep -m 1 "sessionId" | cut -d '"' -f 4`
echo sessionId: $sessionId

if [[ "$bundleId" != "com.apple.springboard" ]]; then
  echo "[$(date +'%d/%m/%Y %H:%M:%S')] Activating springboard app forcibly"
  curl --silent --location --request POST "http://${WDA_HOST}:${WDA_PORT}/session/$sessionId/wda/apps/launch" --header 'Content-Type: application/json' --data-raw '{"bundleId": "com.apple.springboard"}'
  sleep 1
  curl --silent --location --request POST "http://${WDA_HOST}:${WDA_PORT}/session" --header 'Content-Type: application/json' --data-raw '{"capabilities": {"waitForQuiescence": false}}'
fi

# #285 do stop for default wda session to improve homescreen activation during usage in STF
echo "[$(date +'%d/%m/%Y %H:%M:%S')] Stopping 1st default WebDriverAgent session"
curl --silent --location --request GET "http://${WDA_HOST}:${WDA_PORT}/status"  > ${sessionFile}
sessionId=`cat $sessionFile | grep -m 1 "sessionId" | cut -d '"' -f 4`
echo sessionId: $sessionId
curl --silent --location --request DELETE "http://${WDA_HOST}:${WDA_PORT}/session/${sessionId}"

rm -f ${sessionFile}

#TODO: to  improve better 1st super slow session startup we have to investigate extra xcuitest caps: https://github.com/appium/appium-xcuitest-driver
#customSnapshotTimeout, waitForIdleTimeout, animationCoolOffTimeout etc

#TODO: also find a way to override default snapshot generation 60 sec timeout building WebDriverAgent.ipa
