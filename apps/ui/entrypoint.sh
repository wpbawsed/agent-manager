#!/bin/sh
set -e

# Railway (and most PaaS) assign the port dynamically via $PORT and route
# traffic to whatever that is — a hardcoded `listen 3000` in the nginx conf
# causes "Application failed to respond" whenever Railway's assigned port
# isn't 3000. Default to 3000 for docker-compose / local, where nothing sets
# $PORT.
PORT="${PORT:-3000}"
case "$PORT" in
  ''|*[!0-9]*)
    echo "entrypoint.sh: PORT='$PORT' is not numeric, defaulting to 3000" >&2
    PORT=3000
    ;;
esac
export PORT
envsubst '$PORT' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# The build baked the literal string "$VITE_BACKEND_HOST" into the JS bundle
# as a template-literal segment (see Dockerfile + src/api/index.ts). Reject
# anything that isn't a plain http(s) origin before substituting it in —
# envsubst does raw text replacement, so a value containing a backtick or
# "${...}" would inject and execute arbitrary JS in every client's browser.
case "$VITE_BACKEND_HOST" in
  '') ;;
  http://*|https://*)
    case "$VITE_BACKEND_HOST" in
      *'`'*|*'${'*|*'"'*|*"'"*|*'\'*)
        echo "entrypoint.sh: VITE_BACKEND_HOST contains unsafe characters, ignoring it" >&2
        VITE_BACKEND_HOST=''
        ;;
    esac
    ;;
  *)
    echo "entrypoint.sh: VITE_BACKEND_HOST is not a valid http(s) URL, ignoring it" >&2
    VITE_BACKEND_HOST=''
    ;;
esac
export VITE_BACKEND_HOST

for file in /usr/share/nginx/html/assets/*.js; do
  [ -f "$file" ] || continue
  if [ ! -f "$file.orig" ]; then
    cp "$file" "$file.orig"
  fi
  envsubst '$VITE_BACKEND_HOST' < "$file.orig" > "$file"
done

exec nginx -g 'daemon off;'
