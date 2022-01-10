FROM ubuntu:16.04

# Sneak the stf executable into $PATH.
ENV PATH=/opt/bin:/opt/go-ios:$PATH

# Work in app dir by default.
WORKDIR /opt

# Export default app port
EXPOSE 3000

ENV DEVICE_UDID=

# WebDriverAgent vars
ENV WDA_PORT=8100
ENV MJPEG_PORT=8101
ENV WDA_ENV=/opt/zebrunner/wda.env
ENV WDA_LOG_FILE=/opt/zebrunner/wda.log
ENV WDA_WAIT_TIMEOUT=30

RUN apt-get update && \
        apt-get install -y curl wget unzip iputils-ping nano libimobiledevice-utils libimobiledevice6 usbmuxd cmake git build-essential jq
#awscli ffmpeg

# go-ios utility to manage iOS devices connected to Linux provider host
#Grab gidevice from github and extract it in a folder
RUN wget https://github.com/danielpaulus/go-ios/releases/latest/download/go-ios-linux.zip
RUN mkdir go-ios
RUN unzip go-ios-linux.zip -d go-ios
RUN rm go-ios-linux.zip

# Install app requirements. Trying to optimize push speed for dependant apps
# by reducing layers as much as possible. Note that one of the final steps
# installs development files for node-gyp so that npm install won't have to
# wait for them on the first native module installation.
RUN export DEBIAN_FRONTEND=noninteractive && \
    useradd --system \
      --create-home \
      --shell /usr/sbin/nologin \
      stf-build && \
    useradd --system \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    sed -i'' 's@http://archive.ubuntu.com/ubuntu/@mirror://mirrors.ubuntu.com/mirrors.txt@' /etc/apt/sources.list && \
    apt-get update && \
    apt-get -y install wget python build-essential && \
    cd /tmp && \
    wget --progress=dot:mega \
      https://nodejs.org/dist/v8.12.0/node-v8.12.0-linux-x64.tar.xz && \
    tar -xJf node-v*.tar.xz --strip-components 1 -C /usr/local && \
    rm node-v*.tar.xz && \
    su stf-build -s /bin/bash -c '/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js install' && \
    apt-get -y install libzmq3-dev libprotobuf-dev git graphicsmagick openjdk-8-jdk yasm cmake && \
    apt-get clean && \
    rm -rf /var/cache/apt/* /var/lib/apt/lists/* && \
    mkdir /tmp/bundletool && \
    cd /tmp/bundletool && \
    wget --progress=dot:mega \
      https://github.com/google/bundletool/releases/download/1.2.0/bundletool-all-1.2.0.jar && \
    mv bundletool-all-1.2.0.jar bundletool.jar

# Copy app source.
COPY . /tmp/build/

# Give permissions to our build user.
RUN mkdir -p /opt && \
    mkdir -p /data && \
    chown -R stf-build:stf-build /tmp/build /tmp/bundletool /opt && \
    chown -R stf:stf /data /opt/zebrunner

RUN mkdir data &&\
    chown stf-build: data

RUN ln -s /opt /app
# Switch over to the build user.
USER stf-build

# Run the build.
RUN set -x && \
    cd /tmp/build && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    npm install --loglevel http && \
    npm pack && \
    tar xzf devicefarmer-stf-*.tgz --strip-components 1 -C /opt && \
    bower cache clean && \
    npm install rimraf && \
    npm prune --production && \
    mv node_modules /opt && \
    rm -rf ~/.node-gyp && \
    mkdir /opt/bundletool && \
    mv /tmp/bundletool/* /opt/bundletool && \
    cd /opt && \
    find /tmp -mindepth 1 ! -regex '^/tmp/hsperfdata_root\(/.*\)?' -delete

# Switch to the app user.
USER stf

COPY files/start-wda.sh /opt
COPY files/WebDriverAgent.ipa /opt

# Show help by default.
CMD stf --help
