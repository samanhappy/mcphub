#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cleanup() {
  if [ "$?" -ne 0 ]; then docker compose -f tests/docker/replicas/compose.yml logs --tail=80; fi
  docker compose -f tests/docker/replicas/compose.yml down --volumes
}
trap cleanup EXIT
docker compose -f tests/docker/replicas/compose.yml up --detach --build --wait --wait-timeout 120
node tests/docker/replicas/smoke.mjs
