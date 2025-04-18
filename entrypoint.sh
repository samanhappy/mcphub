#!/bin/bash

NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmjs.org/}
echo "Setting npm registry to ${NPM_REGISTRY}"
npm config set registry "$NPM_REGISTRY"

echo "Using REQUEST_TIMEOUT: $REQUEST_TIMEOUT"
echo "Using UV_PYTHON_INSTALL_MIRROR: $UV_PYTHON_INSTALL_MIRROR"

exec "$@"
