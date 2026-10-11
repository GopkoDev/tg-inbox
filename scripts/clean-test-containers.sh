#!/usr/bin/env bash
# Removes Testcontainers leftovers (containers labelled org.testcontainers=true) and the
# anonymous volumes they mounted. Never touches unlabelled containers or named volumes
# (compose tg-postgres-1, tg_pgdata, ...).
set -euo pipefail

ids=$(docker ps -aq --filter label=org.testcontainers=true)
volumes=""
if [ -n "$ids" ]; then
  # shellcheck disable=SC2086
  volumes=$(docker inspect -f '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' $ids)
  # shellcheck disable=SC2086
  docker rm -f -v $ids >/dev/null
fi
for v in $volumes; do
  docker volume rm "$v" >/dev/null 2>&1 || true
done
echo "removed $(printf '%s' "$ids" | grep -c . || true) testcontainers container(s)"
