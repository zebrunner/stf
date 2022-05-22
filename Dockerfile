#
# Copyright © 2022 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
#

FROM ubuntu:20.04

# Sneak the stf executable into $PATH.
ENV PATH=/opt/bin:$PATH

# Work in app dir by default.
WORKDIR /opt

# Export default app port
EXPOSE 3000

ENV DEVICE_UDID=

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && \
        apt-get install -y curl wget unzip iputils-ping nano telnet libimobiledevice-utils libimobiledevice6 usbmuxd cmake git build-essential jq libplist-utils

# jq - jquery command line to operate with go-ios utility
# libplist-utils - plistutil to convert binary Info.plist into the xml

# go-ios utility to manage iOS devices connected to Linux provider host
#Grab gidevice from github and extract it in a folder
RUN wget https://github.com/danielpaulus/go-ios/releases/download/v1.0.69/go-ios-linux.zip && unzip go-ios-linux.zip -d /usr/local/bin && rm go-ios-linux.zip

# Install app requirements. Trying to optimize push speed for dependant apps
# by reducing layers as much as possible. Note that one of the final steps
# installs development files for node-gyp so that npm install won't have to
# wait for them on the first native module installation.
RUN useradd --system \
      --create-home \
      --shell /usr/sbin/nologin \
      stf-build && \
    useradd --system \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    sed -i'' 's@http://archive.ubuntu.com/ubuntu/@mirror://mirrors.ubuntu.com/mirrors.txt@' /etc/apt/sources.list && \
    apt-get update && \
    apt-get -y install wget python3 build-essential && \
    cd /tmp && \
    wget --progress=dot:mega \
      https://nodejs.org/dist/v17.9.0/node-v17.9.0-linux-x64.tar.xz && \
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
    chown -R stf:stf /data

RUN mkdir data &&\
    chown stf-build: data

RUN ln -s /opt /app
# Switch over to the build user.
USER stf-build

# Run the build.
RUN set -x && \
    cd /tmp/build && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    npm install --python="/usr/bin/python3"  --loglevel http && \
    npm pack && \
    tar xzf devicefarmer-stf-*.tgz --strip-components 1 -C /opt && \
    bower cache clean && \
    npm prune --production && \
    mv node_modules /opt && \
    rm -rf ~/.node-gyp && \
    mkdir /opt/bundletool && \
    mv /tmp/bundletool/* /opt/bundletool && \
    cd /opt && \
    find /tmp -mindepth 1 ! -regex '^/tmp/hsperfdata_root\(/.*\)?' -delete

# Switch to the app user.
USER stf
##Use root user only for debug
#USER root

# Show help by default.
CMD stf --help
