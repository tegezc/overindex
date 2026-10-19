#!/bin/sh
# Start a prebuilt image on the e2-micro. This host has 1 GB RAM.
# Do not docker build, npm install, or next build here.
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root on the VM." >&2
  exit 1
fi

if [ "$#" -ne 0 ]; then
  echo "No arguments. This script does not build. Set IMAGE to a prebuilt reference." >&2
  exit 1
fi

IMAGE=${IMAGE:-}
case $IMAGE in
  "")
    echo "Set IMAGE to an image that was built off this VM." >&2
    exit 1
    ;;
  -*)
    echo "IMAGE must not start with a dash." >&2
    exit 1
    ;;
esac

ENV_FILE=/etc/overindex.env
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE. Install it with deploy/gce/install-env.sh without printing secrets." >&2
  exit 1
fi

mode=$(stat -c '%a' "$ENV_FILE")
if [ "$mode" != "600" ]; then
  echo "$ENV_FILE must be mode 600 (found $mode)." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Install it only to run a prebuilt image, not to build one." >&2
  exit 1
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  docker pull "$IMAGE"
fi

install -d -m 755 /var/lib/overindex/data

if docker ps -a --format '{{.Names}}' | grep -qx overindex; then
  docker rm -f overindex >/dev/null
fi

docker run -d \
  --name overindex \
  --restart unless-stopped \
  --pull never \
  -p 80:3000 \
  --env-file "$ENV_FILE" \
  -e CACHE_DIR=/data \
  -e NODE_ENV=production \
  -e HOSTNAME=0.0.0.0 \
  -v /var/lib/overindex/data:/data \
  "$IMAGE"

echo "Container overindex started from a prebuilt image."
echo "This script does not prove a public /api/health response."
