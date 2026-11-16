#
# Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
#

# Fork (Zebrunner): the build stage builds /app with the build tools (gcc,
# python3, cmake, the -dev packages, the JDK), the image gets /app, node and
# the runtime packages only. The base is pinned by the digest of its
# multi-platform index (Dependabot updates it).
FROM ubuntu:26.04@sha256:065aa8626841f16057b78b027b464cd59c4fac36c204c72dcbf48d66f5fa8a96 AS build

WORKDIR /app
COPY . /tmp/build/

ARG TARGETARCH

# Fork (Zebrunner): the steps below run for amd64 or arm64 only; another or an
# empty TARGETARCH (the builder without BuildKit) stops the build here.
RUN case "${TARGETARCH}" in \
      amd64|arm64) ;; \
      *) echo "TARGETARCH '${TARGETARCH}' is not supported: build linux/amd64 or linux/arm64 with BuildKit" >&2; \
        exit 1 ;; \
    esac

# Fork (Zebrunner): the amd64 and arm64 images are alike: stf has the uid 998,
# /app belongs to root, the build tools and caches are removed. zeromq ships
# its glibc addon for arm64, no musl libc nor pnpm is needed to build it.
# npm ci installs the versions of the committed package-lock.json. The Node.js
# tarballs are checked by their sha256 of
# https://nodejs.org/dist/v22.23.2/SHASUMS256.txt (.nvmrc has the version).
RUN if [ "$TARGETARCH" = "amd64" ]; then \
    export DEBIAN_FRONTEND=noninteractive && \
    useradd --system \
      --uid 998 \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    echo '--- Updating repositories' && \
    apt-get update && \
    echo '--- Upgrading repositories' && \
    apt-get -y dist-upgrade && \
    apt-get -y install wget python3 build-essential && \
    cd /tmp && \
    wget --progress=dot:mega \
      https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-x64.tar.xz && \
    echo 'd60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307  node-v22.23.2-linux-x64.tar.xz' > node.sha256 && \
    sha256sum -c node.sha256 && \
    tar -xJf node-v*.tar.xz --strip-components 1 -C /usr/local && \
    rm node-v*.tar.xz node.sha256 && \
    su stf -s /bin/bash -c '/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js install' && \
    apt-get -y install --no-install-recommends libzmq3-dev libprotobuf-dev git yasm cmake && \
    apt-get clean && \
    rm -rf /var/cache/apt/* /var/lib/apt/lists/* && \
    mkdir -p /app && \
    chown -R stf:stf /tmp/build /app && \
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
    echo 'fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8  node-v22.23.2-linux-arm64.tar.xz' > node.sha256 && \
    sha256sum -c node.sha256 && \
    tar -xJf node-v*.tar.xz --strip-components 1 -C /usr/local && \
    rm node-v*.tar.xz node.sha256 && \
    useradd --system \
      --uid 998 \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    su stf -s /bin/bash -c '/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js install' && \
    apt-get -y install --no-install-recommends libzmq3-dev libprotobuf-dev git yasm && \
    echo '--- Building app' && \
    mkdir -p /app && \
    chown -R stf:stf /tmp/build && \
    set -x && \
    cd /tmp/build && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    export VCPKG_FORCE_SYSTEM_BINARIES="arm" && \
    echo 'npm ci --python="/usr/bin/python3" --loglevel http' | su stf -s /bin/bash && \
    echo '--- Assembling app' && \
    echo 'npm pack' | su stf -s /bin/bash && \
    tar xzf devicefarmer-stf-*.tgz --strip-components 1 -C /app && \
    test -d /app/res/build && \
    echo 'npm prune --omit=dev' | su stf -s /bin/bash && \
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

FROM ubuntu:26.04@sha256:065aa8626841f16057b78b027b464cd59c4fac36c204c72dcbf48d66f5fa8a96

# Sneak the stf executable into $PATH.
ENV PATH=/app/bin:$PATH

# Work in app dir by default.
WORKDIR /app

# Export default app port, not enough for all processes but it should do
# for now.
EXPOSE 3000

# Fork (Zebrunner): the runtime packages: java (OpenJDK 21) and keytool of
# bundletool (storage-temp, .aab), gm (storage-plugin-image), plistutil (the
# binary Info.plist of the uploaded .ipa files, storage-plugin-apk), the
# TurboJPEG of @julusian/jpeg-turbo; stf has the uid 998, /app belongs to root.
RUN useradd --system \
      --uid 998 \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    export DEBIAN_FRONTEND=noninteractive && \
    apt-get update && \
    apt-get -y dist-upgrade && \
    apt-get -y install --no-install-recommends \
      ca-certificates graphicsmagick openjdk-21-jre-headless libplist-utils libturbojpeg0 && \
    apt-get clean && \
    rm -rf /var/cache/apt/* /var/lib/apt/lists/*

COPY --from=build /usr/local/bin/node /usr/local/bin/node
COPY --from=build /app /app

# Fork (Zebrunner): bundletool converts the uploaded .aab files into universal .apk
# files (storage-temp, --bundletool-path), the release checked by its sha256
ADD --checksum=sha256:a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29 \
    https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar /app/bundletool/bundletool.jar
RUN chmod 644 /app/bundletool/bundletool.jar

# Fork (Zebrunner): the iOS tools (go-ios, socat) are in the mcloud-device image; the
# platform icons (/app/icon) are served by lib/units/app/middleware/device-icons.ts.

# Fork (Zebrunner): /data of storage-temp (--save-dir /data) belongs to stf: a new
# volume mounted there gets the owner of the directory of the image, the uploads
# (screenshots, apps, images) fail without it
RUN mkdir -p /data && chown stf:stf /data

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
