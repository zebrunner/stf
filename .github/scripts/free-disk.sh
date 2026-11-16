#!/usr/bin/env bash
#
# Fork (Zebrunner): remove the preinstalled toolchains CI does not use, only
# when the root filesystem has less than <GiB> free.
#
# usage: free-disk.sh <GiB> [docker-prune]
#
# An Android leg needs a system image, node_modules and a 6G userdata partition,
# the Compose job the STF image and an AVD as well: about 12G. The ubuntu-24.04
# image has 86G free (145G root), and the removal took 20-40 s of every job, so
# it only runs on a runner that would not have the room.
#
set -euo pipefail

need="${1:?usage: free-disk.sh <GiB> [docker-prune]}"

df -h /
free=$(df --output=avail -BG / | tail -1 | tr -dc '0-9')
if [ "$free" -ge "$need" ]; then
  echo "${free}G free, at least ${need}G needed: nothing to remove"
  exit 0
fi

echo "${free}G free, ${need}G needed: removing the unused toolchains"
sudo rm -rf /usr/share/dotnet /usr/share/swift /opt/ghc \
  /usr/local/share/boost /usr/local/lib/android/sdk/ndk \
  /usr/local/share/powershell 2>/dev/null || true
if [ "${2:-}" = docker-prune ]; then
  docker image prune -af 2>/dev/null || true
fi
df -h /
