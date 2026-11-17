#!/bin/sh
set -eu
if [ -z "${WORKNOTE_PASSWORD:-}" ] || [ -z "${WORKNOTE_SECRET:-}" ]; then
  printf '%s\n' 'Set WORKNOTE_PASSWORD and WORKNOTE_SECRET in .env before starting WorkNote.' >&2
  exit 1
fi
node scripts/init.mjs --no-env
exec "$@"
