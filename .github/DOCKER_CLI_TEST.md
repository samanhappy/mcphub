# Docker Engine Installation Test Procedure

This document describes how to test the Docker Engine installation feature added with the `INSTALL_EXT=true` build argument.

## Test 1: Build with INSTALL_EXT=false (default)

```bash
# Build without extended features
docker build -t mcphub:base .

# Run the container
docker run --rm mcphub:base docker --version
```

**Expected Result**: `docker: not found` error (Docker is NOT installed)

## Test 2: Build with INSTALL_EXT=true

```bash
# Build with extended features
docker build --build-arg INSTALL_EXT=true -t mcphub:extended .

# Test Docker CLI is available
docker run --rm mcphub:extended docker --version
```

**Expected Result**: Docker version output (e.g., `Docker version 27.x.x, build xxxxx`)

## Test 3: Docker-in-Docker with Auto-start Daemon

```bash
# Build with extended features
docker build --build-arg INSTALL_EXT=true -t mcphub:extended .

# Run with privileged mode (allows Docker daemon to start)
docker run -d \
  --name mcphub-test \
  --privileged \
  -p 3000:3000 \
  mcphub:extended

# Wait a few seconds for daemon to start
sleep 5

# Test Docker commands from inside the container
docker exec mcphub-test docker ps
docker exec mcphub-test docker images
docker exec mcphub-test docker info

# Cleanup
docker stop mcphub-test
docker rm mcphub-test
```

**Expected Result**: 
- Docker daemon should auto-start inside the container
- Docker commands should work without mounting the host's Docker socket
- `docker info` should show the container's own Docker daemon

## Test 4: Docker-in-Docker with Host Socket (Alternative)

```bash
# Build with extended features
docker build --build-arg INSTALL_EXT=true -t mcphub:extended .

# Run with Docker socket mounted (uses host's daemon)
docker run -d \
  --name mcphub-test \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  mcphub:extended

# Test Docker commands from inside the container
docker exec mcphub-test docker ps
docker exec mcphub-test docker images

# Cleanup
docker stop mcphub-test
docker rm mcphub-test
```

**Expected Result**: 
- Docker daemon should NOT auto-start (socket already exists from host)
- Docker commands should work and show the host's containers and images

## Test 5: Verify Image Size

```bash
# Build both versions
docker build -t mcphub:base .
docker build --build-arg INSTALL_EXT=true -t mcphub:extended .

# Compare image sizes
docker images mcphub:*
```

**Expected Result**: 
- The `extended` image should be larger than the `base` image
- The size difference should be reasonable (Docker Engine adds ~100-150MB)

## Test 6: Architecture Support

```bash
# On AMD64/x86_64
docker build --build-arg INSTALL_EXT=true --platform linux/amd64 -t mcphub:extended-amd64 .

# On ARM64
docker build --build-arg INSTALL_EXT=true --platform linux/arm64 -t mcphub:extended-arm64 .
```

**Expected Result**: 
- Both builds should succeed
- AMD64 includes Chrome/Playwright + Docker Engine
- ARM64 includes Docker Engine only (Chrome installation is skipped)

## Notes

- The Docker Engine installation follows the official Docker documentation
- Includes full Docker daemon (`dockerd`), CLI (`docker`), and containerd
- The daemon auto-starts when running in privileged mode
- The installation uses the Debian Bookworm repository
- All temporary files are cleaned up to minimize image size
- The feature is opt-in via the `INSTALL_EXT` build argument
- `iptables` is installed as it's required for Docker networking
