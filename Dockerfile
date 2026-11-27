#
# Copyright © 2022-2024 contains code contributed by Orange SA, authors: Denis Barbaron - Licensed under the Apache license 2.0
#

# Fork (Zebrunner): the build stages build /app with the build tools (gcc,
# python3, cmake, the -dev packages, the JDK), the image gets /app, its
# node_modules, node and the runtime packages only. The base is pinned by the
# digest of its multi-platform index (Dependabot updates it).
FROM ubuntu:26.04@sha256:d66b366dac61b575bee2aef07e9c26e8070096fbe84a3d4d3eb0da069b5d76db AS deps

ARG TARGETARCH

# Fork (Zebrunner): the steps below run for amd64 or arm64 only; another or an
# empty TARGETARCH (the builder without BuildKit) stops the build here.
RUN case "${TARGETARCH}" in \
      amd64|arm64) ;; \
      *) echo "TARGETARCH '${TARGETARCH}' is not supported: build linux/amd64 or linux/arm64 with BuildKit" >&2; \
        exit 1 ;; \
    esac

# Fork (Zebrunner): the layers go from the least to the most often changed, so a
# change of the sources reuses the build tools, Node.js, the npm ci and the
# node_modules of the image from the cache (the buildx cache of CI, doc/ci.md):
# the packages, Node.js, the dependencies of package-lock.json (stage deps, then
# prod-deps for the image), then the sources (stage build). The amd64 and arm64
# images are alike: stf has the uid 998, /app belongs to root. zeromq ships its
# glibc addon for arm64, no musl libc nor pnpm is needed to build it.
RUN export DEBIAN_FRONTEND=noninteractive && \
    echo '--- Updating repositories' && \
    apt-get update && \
    echo '--- Upgrading repositories' && \
    apt-get -y dist-upgrade && \
    if [ "$TARGETARCH" = "amd64" ]; then \
      apt-get -y install wget python3 build-essential && \
      apt-get -y install --no-install-recommends libzmq3-dev libprotobuf-dev git yasm cmake; \
    else \
      apt-get -y install pkg-config curl zip unzip wget python3 build-essential cmake ninja-build && \
      apt-get -y install --no-install-recommends libzmq3-dev libprotobuf-dev git yasm; \
    fi && \
    apt-get clean && \
    rm -rf /var/cache/apt/* /var/lib/apt/lists/*

# Fork (Zebrunner): the Node.js tarballs are checked by their sha256 of
# https://nodejs.org/dist/v22.23.2/SHASUMS256.txt (.nvmrc has the version).
RUN case "$TARGETARCH" in \
      amd64) node_arch=x64; \
        node_sha256=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307 ;; \
      arm64) node_arch=arm64; \
        node_sha256=fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8 ;; \
    esac && \
    cd /tmp && \
    wget --progress=dot:mega \
      "https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-$node_arch.tar.xz" && \
    echo "$node_sha256  node-v22.23.2-linux-$node_arch.tar.xz" > node.sha256 && \
    sha256sum -c node.sha256 && \
    tar -xJf node-v*.tar.xz --strip-components 1 -C /usr/local && \
    rm node-v*.tar.xz node.sha256 && \
    useradd --system \
      --uid 998 \
      --create-home \
      --shell /usr/sbin/nologin \
      stf && \
    su stf -s /bin/bash -c '/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js install' && \
    mkdir -p /app /tmp/build && \
    chown stf:stf /tmp/build

WORKDIR /tmp/build

# Fork (Zebrunner): npm ci installs the versions of the committed
# package-lock.json, without the prepare script of the package (it builds the
# sources, which come in the next layer); the npm cache is a cache mount.
COPY --chown=stf:stf package.json package-lock.json ./
RUN --mount=type=cache,id=stf-npm-${TARGETARCH},target=/home/stf/.npm,uid=998,gid=998 \
    set -x && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    if [ "$TARGETARCH" = "arm64" ]; then export VCPKG_FORCE_SYSTEM_BINARIES="arm"; fi && \
    echo '--- Installing the dependencies' && \
    echo 'npm pkg delete scripts.prepare && npm ci --python="/usr/bin/python3" --loglevel http' | su stf -s /bin/bash

# Fork (Zebrunner): the node_modules of the image, without the dev dependencies.
# The prebuilt addons of Windows and macOS are not loaded on Linux
# (node-gyp-build and cmake-ts pick the one of the platform).
FROM deps AS prod-deps
RUN echo 'npm prune --omit=dev' | su stf -s /bin/bash && \
    find node_modules \( -path '*/prebuilds/*win32*' -o -path '*/prebuilds/*darwin*' \
      -o -path '*/zeromq/build/win32' -o -path '*/zeromq/build/darwin' \) -prune -exec rm -rf {} +

# Fork (Zebrunner): npm pack runs the prepare script (node build.mts build).
FROM deps AS build
COPY --chown=stf:stf . ./
RUN set -x && \
    export PATH=$PWD/node_modules/.bin:$PATH && \
    if [ "$TARGETARCH" = "arm64" ]; then export VCPKG_FORCE_SYSTEM_BINARIES="arm"; fi && \
    echo '--- Assembling app' && \
    echo 'npm pack' | su stf -s /bin/bash && \
    tar xzf devicefarmer-stf-*.tgz --strip-components 1 -C /app && \
    test -d /app/res/build && \
    mkdir -m 775 /app/node_modules && \
    chown -R root:root /app && \
    cd /app && \
    rm -rf doc .github .tx .semaphore *.md *.yaml LICENSE Dockerfile* \
      .eslintrc .nvmrc .tool-versions res/.eslintrc

FROM ubuntu:26.04@sha256:d66b366dac61b575bee2aef07e9c26e8070096fbe84a3d4d3eb0da069b5d76db

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
# Fork (Zebrunner): into the node_modules of /app, which has the mode npm gives it (775)
COPY --from=prod-deps --chown=root:root /tmp/build/node_modules /app/node_modules

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
