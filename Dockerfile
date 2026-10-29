#
# Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
#

# Fork (Zebrunner): the build stage builds /app with the build tools (gcc,
# python3, cmake, the -dev packages, the JDK), the image gets /app, node and
# the runtime packages only.
FROM ubuntu:22.04 AS build

WORKDIR /app
COPY . /tmp/build/

ARG TARGETARCH

# Fork (Zebrunner): the amd64 and arm64 images are alike: stf has the uid 998,
# /app belongs to root, the build tools and caches are removed. zeromq ships
# its glibc addon for arm64, no musl libc nor pnpm is needed to build it.
# npm ci installs the versions of the committed package-lock.json.
RUN if [ "$TARGETARCH" = "amd64" ]; then \
    export DEBIAN_FRONTEND=noninteractive && \
    useradd --system \
      --uid 998 \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    sed -i'' 's@http://archive.ubuntu.com/ubuntu/@mirror://mirrors.ubuntu.com/mirrors.txt@' /etc/apt/sources.list && \
    echo '--- Updating repositories' && \
    apt-get update && \
    echo '--- Upgrading repositories' && \
    apt-get -y dist-upgrade && \
    apt-get -y install wget python3 build-essential && \
    cd /tmp && \
    wget --progress=dot:mega \
      https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz && \
    tar -xJf node-v*.tar.xz --strip-components 1 -C /usr/local && \
    rm node-v*.tar.xz && \
    su stf -s /bin/bash -c '/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js install' && \
    apt-get -y install --no-install-recommends libzmq3-dev libprotobuf-dev git graphicsmagick openjdk-8-jdk yasm cmake && \
    apt-get clean && \
    rm -rf /var/cache/apt/* /var/lib/apt/lists/* && \
    mkdir /tmp/bundletool && \
    cd /tmp/bundletool && \
    wget --progress=dot:mega \
      https://github.com/google/bundletool/releases/download/1.2.0/bundletool-all-1.2.0.jar && \
    mv bundletool-all-1.2.0.jar bundletool.jar && \
    mkdir -p /app && \
    chown -R stf:stf /tmp/build /tmp/bundletool /app && \
    set -x && \
    echo '--- Building app' && \
    cd /tmp/build && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    echo 'npm ci --python="/usr/bin/python3" --loglevel http' | su stf -s /bin/bash && \
    echo '--- Assembling app' && \
    echo 'npm pack' | su stf -s /bin/bash && \
    tar xzf devicefarmer-stf-*.tgz --strip-components 1 -C /app && \
    test -d /app/res/build && \
    npm prune --omit=dev && \
    mv node_modules /app && \
    rm -rf ~/.node-gyp && \
    mkdir /app/bundletool && \
    mv /tmp/bundletool/* /app/bundletool && \
    chown -R root:root /app && \
    echo '--- Cleaning up' && \
    apt-get -y purge wget python3 build-essential cmake && \
    apt-get -y autoremove && \
    rm -rf /var/cache/apt/* /var/lib/apt/lists/* && \
    rm -rf /home/stf/.npm /home/stf/.cache /home/stf/.config /home/stf/.local && \
    cd /app && \
    find /tmp -mindepth 1 ! -regex '^/tmp/hsperfdata_root\(/.*\)?' -delete && \
    rm -rf doc .github .tx .semaphore *.md *.yaml LICENSE Dockerfile* \
      .eslintrc .nvmrc .tool-versions res/.eslintrc && \
    cd && \
    rm -rf .npm .cache .config .local && \
    cd /app; \
  fi
  
RUN if [ "$TARGETARCH" = "arm64" ]; then \
    export DEBIAN_FRONTEND=noninteractive && \
    echo '--- Updating repositories' && \
    apt-get update && \
    echo '--- Upgrading repositories' && \
    apt-get -y dist-upgrade && \
    echo '--- Building node' && \
    apt-get -y install pkg-config curl zip unzip wget python3 build-essential cmake ninja-build && \
    cd /tmp && \
    wget --progress=dot:mega \
      https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-arm64.tar.xz && \
    tar -xJf node-v*.tar.xz --strip-components 1 -C /usr/local && \
    rm node-v*.tar.xz && \
    useradd --system \
      --uid 998 \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    su stf -s /bin/bash -c '/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js install' && \
    apt-get -y install --no-install-recommends libzmq3-dev libprotobuf-dev git graphicsmagick openjdk-8-jdk yasm && \
    echo '--- Building app' && \
    mkdir -p /app && \
    chown -R stf:stf /tmp/build && \
    set -x && \
    cd /tmp/build && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    sed -i'' -e '/phantomjs/d' package.json && \
    export VCPKG_FORCE_SYSTEM_BINARIES="arm" && \
    echo 'npm ci --python="/usr/bin/python3" --loglevel http' | su stf -s /bin/bash && \
    echo '--- Assembling app' && \
    echo 'npm pack' | su stf -s /bin/bash && \
    tar xzf devicefarmer-stf-*.tgz --strip-components 1 -C /app && \
    test -d /app/res/build && \
    echo 'npm prune --omit=dev' | su stf -s /bin/bash && \
    wget --progress=dot:mega \
      https://github.com/google/bundletool/releases/download/1.2.0/bundletool-all-1.2.0.jar && \
    mkdir -p /app/bundletool && \
    mv bundletool-all-1.2.0.jar /app/bundletool/bundletool.jar && \
    mv node_modules /app && \
    chown -R root:root /app && \
    echo '--- Cleaning up' && \
    echo 'npm cache clean --force' | su stf -s /bin/bash && \
    rm -rf ~/.node-gyp && \
    apt-get -y purge pkg-config curl zip unzip wget python3 build-essential cmake ninja-build && \
    apt-get -y clean && \
    apt-get -y autoremove && \
    cd /home/stf && \
    rm -rf vcpkg .npm .cache .cmake-ts .config .local && \
    rm -rf /var/cache/apt/* /var/lib/apt/lists/* && \
    cd /app && \
    rm -rf doc .github .tx .semaphore *.md *.yaml LICENSE Dockerfile* \
      .eslintrc .nvmrc .tool-versions res/.eslintrc && \
    rm -rf /tmp/*; \
  fi

# Fork (Zebrunner): the prebuilt addons of Windows and macOS are not loaded on
# Linux (node-gyp-build and cmake-ts pick the one of the platform)
RUN find /app/node_modules \( -path '*/prebuilds/*win32*' -o -path '*/prebuilds/*darwin*' \
      -o -path '*/zeromq/build/win32' -o -path '*/zeromq/build/darwin' \) -prune -exec rm -rf {} +

FROM ubuntu:22.04

# Sneak the stf executable into $PATH.
ENV PATH=/app/bin:$PATH

# Work in app dir by default.
WORKDIR /app

# Export default app port, not enough for all processes but it should do
# for now.
EXPOSE 3000

# Fork (Zebrunner): the runtime packages: java and keytool of bundletool
# (storage-temp, .aab), gm (storage-plugin-image), plistutil (the binary
# Info.plist of the uploaded .ipa files, storage-plugin-apk), libturbojpeg of
# @julusian/jpeg-turbo; stf has the uid 998, /app belongs to root.
RUN useradd --system \
      --uid 998 \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    export DEBIAN_FRONTEND=noninteractive && \
    apt-get update && \
    apt-get -y dist-upgrade && \
    apt-get -y install --no-install-recommends \
      ca-certificates graphicsmagick openjdk-8-jre-headless libplist-utils libturbojpeg && \
    apt-get clean && \
    rm -rf /var/cache/apt/* /var/lib/apt/lists/*

COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app /app

# Fork (Zebrunner): the platform icons replace the generic ones of
# stf-device-db. The iOS tools (go-ios, socat) are in the mcloud-device image.
RUN cd /app/node_modules/@devicefarmer/stf-device-db/dist/icon && \
    cp /app/icon/x120/iOS.jpg x120/iOS && \
    cp /app/icon/x24/iOS.jpg x24/iOS && \
    cp /app/icon/x120/Android.jpg x120/Android && \
    cp /app/icon/x24/Android.jpg x24/Android && \
    cp /app/icon/x120/tvOS.png x120/tvOS && \
    cp /app/icon/x24/tvOS.png x24/tvOS

# Switch to the app user.
USER stf

# The version of the image: make build VERSION=<tag> (ZEBRUNNER.md#build)
ARG VERSION=dev
LABEL org.opencontainers.image.title="Zebrunner STF" \
      org.opencontainers.image.source="https://github.com/zebrunner/stf" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0"

# Show help by default.
CMD ["stf", "--help"]
