#!/bin/sh
set -e

# The build baked the literal string "$VITE_BACKEND_HOST" into the JS bundle
# (see Dockerfile). Substitute it with the real runtime value here, so a
# single built image can point at any backend without rebuilding.
for file in /usr/share/nginx/html/assets/*.js; do
  [ -f "$file" ] || continue
  if [ ! -f "$file.orig" ]; then
    cp "$file" "$file.orig"
  fi
  envsubst '$VITE_BACKEND_HOST' < "$file.orig" > "$file"
done

exec nginx -g 'daemon off;'
