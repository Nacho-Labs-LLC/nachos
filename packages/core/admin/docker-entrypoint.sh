#!/bin/sh
# Detect the Docker socket GID at runtime and grant access to the nachos user.
# Docker Desktop (macOS) remaps the socket to root:root (GID 0) inside the
# container, so a build-time DOCKER_GID arg doesn't work reliably.

SOCK=/var/run/docker.sock

if [ -S "$SOCK" ]; then
  SOCK_GID=$(stat -c '%g' "$SOCK" 2>/dev/null)
  if [ -n "$SOCK_GID" ] && [ "$SOCK_GID" != "0" ]; then
    # Non-root GID: create/find group and add nachos
    EXISTING=$(getent group "$SOCK_GID" | cut -d: -f1)
    if [ -n "$EXISTING" ]; then
      adduser nachos "$EXISTING" 2>/dev/null || true
    else
      addgroup -g "$SOCK_GID" docker 2>/dev/null || true
      adduser nachos docker 2>/dev/null || true
    fi
  else
    # GID 0 (root) — add nachos to root group
    adduser nachos root 2>/dev/null || true
  fi
fi

# Drop privileges and exec the main process
exec su-exec nachos "$@"
