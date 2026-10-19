#!/bin/sh
# Copy an env file into place on the VM without printing secret values.
# Usage (as root): install-env.sh /tmp/overindex.env
set -eu

src=${1:?path to env file}
dest=/etc/overindex.env

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root on the VM." >&2
  exit 1
fi

if [ "$src" = "$dest" ]; then
  echo "Refusing to use the destination as the source." >&2
  exit 1
fi

if [ ! -f "$src" ]; then
  echo "Env file not found. Do not paste its contents into the command." >&2
  exit 1
fi

install -m 600 -o root -g root "$src" "$dest"
sed -i 's/\r$//' "$dest"
sed -i '1s/^\xEF\xBB\xBF//' "$dest"
rm -f "$src"

check_key() {
  name=$1
  if grep -Eq "^${name}=.+" "$dest"; then
    echo "$name set"
    return 0
  fi
  echo "$name missing" >&2
  return 1
}

stat -c '%a %U %G' "$dest"
ok=0
check_key QLOO_API_KEY || ok=1
check_key OPENAI_API_KEY || ok=1
exit "$ok"
