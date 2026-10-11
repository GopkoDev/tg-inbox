#!/usr/bin/env bash
# Removes Testcontainers leftovers (containers labelled org.testcontainers=true) together with
# their anonymous volumes (`docker rm -v`). Never touches unlabelled containers or named volumes
# (compose tg-postgres-1, tg_pgdata, ...).
set -euo pipefail

ids=$(docker ps -aq --filter label=org.testcontainers=true)
if [ -n "$ids" ]; then
  # shellcheck disable=SC2086
  docker rm -f -v $ids >/dev/null
fi
echo "removed $(printf '%s' "$ids" | grep -c . || true) testcontainers container(s)"
