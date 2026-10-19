#!/bin/sh
# The cache directory may be mounted as root. Fix ownership, then run Next.js as app.
set -eu
export HOME=/home/app
if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /data
  chown app:nodejs /data
  exec runuser --preserve-environment --user app --group nodejs -- "$@"
fi
exec "$@"
