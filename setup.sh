#!/usr/bin/env bash
#
# Set up a local development environment for this project.
#
# The site itself ships no dependencies — it is plain ES modules with no build
# step — so nothing is installed into the page. What this script provisions is
# the toolchain needed to work on it:
#
#   .venv/       Python virtual environment (runs the dev server; also picks up
#                requirements.txt if one is ever added)
#   .tools/node  Node.js, only if the system doesn't already have a new enough
#                one — used by `node --test`
#
# Everything lands inside the project directory. Nothing is installed globally,
# no sudo is needed, and `rm -rf .venv .tools` undoes all of it.
#
# Usage:  ./setup.sh
#         NODE_VERSION=v22.20.0 ./setup.sh   # pin a specific Node release

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

VENV_DIR=".venv"
TOOLS_DIR=".tools"
NODE_DIR="$TOOLS_DIR/node"
MIN_NODE_MAJOR=20 # `node --test` is only stable from Node 20

SETUP_TMP=""
trap 'rm -rf "$SETUP_TMP"' EXIT

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$1" >&2; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$1" >&2
  exit 1
}

# ---------- Python virtual environment ----------

setup_python() {
  command -v python3 >/dev/null 2>&1 || die "python3 not found — install Python 3 and re-run."

  if [ -x "$VENV_DIR/bin/python" ]; then
    say "Python venv already present at $VENV_DIR"
  else
    say "Creating Python venv in $VENV_DIR"
    python3 -m venv "$VENV_DIR"
  fi

  # Quietly bring pip up to date so the venv is usable for anything added later.
  "$VENV_DIR/bin/python" -m pip install --quiet --upgrade pip >/dev/null 2>&1 ||
    warn "could not upgrade pip (offline?) — the venv still works"

  if [ -f requirements.txt ]; then
    say "Installing Python packages from requirements.txt"
    "$VENV_DIR/bin/pip" install --quiet -r requirements.txt
  else
    say "No requirements.txt — the venv is empty, which is expected"
  fi
}

# ---------- Node.js ----------

node_major() { "$1" --version 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'; }

# Newest LTS release, resolved from the official release index so this script
# doesn't rot around a hardcoded version. Override with $NODE_VERSION.
resolve_node_version() {
  python3 - <<'PY'
import json, sys, urllib.request
try:
    with urllib.request.urlopen("https://nodejs.org/dist/index.json", timeout=30) as r:
        releases = json.load(r)
except Exception as e:
    sys.exit(f"could not reach nodejs.org: {e}")
print(next(rel["version"] for rel in releases if rel["lts"]))
PY
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else die "neither shasum nor sha256sum found — cannot verify the download"
  fi
}

install_node() {
  local version="$1" os arch tarball url tmp expected actual
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) die "unsupported OS $(uname -s) — install Node $MIN_NODE_MAJOR+ manually and re-run." ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch="arm64" ;;
    x86_64 | amd64) arch="x64" ;;
    *) die "unsupported architecture $(uname -m) — install Node $MIN_NODE_MAJOR+ manually and re-run." ;;
  esac

  tarball="node-${version}-${os}-${arch}.tar.gz"
  url="https://nodejs.org/dist/${version}/${tarball}"
  tmp="$(mktemp -d)"
  SETUP_TMP="$tmp" # cleaned up by the EXIT trap, which outlives this function

  say "Downloading $tarball"
  curl -fsSL --retry 3 -o "$tmp/$tarball" "$url" || die "download failed: $url"

  # Check the tarball against the checksums published alongside the release.
  say "Verifying checksum"
  curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/${version}/SHASUMS256.txt" ||
    die "could not fetch SHASUMS256.txt for $version"
  expected="$(grep "  ${tarball}\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
  [ -n "$expected" ] || die "no checksum published for $tarball"
  actual="$(sha256_of "$tmp/$tarball")"
  [ "$expected" = "$actual" ] || die "checksum mismatch for $tarball (expected $expected, got $actual)"

  say "Unpacking into $NODE_DIR"
  rm -rf "$NODE_DIR"
  mkdir -p "$NODE_DIR"
  tar -xzf "$tmp/$tarball" -C "$NODE_DIR" --strip-components=1
}

setup_node() {
  if [ -x "$NODE_DIR/bin/node" ] && [ "$(node_major "$NODE_DIR/bin/node")" -ge "$MIN_NODE_MAJOR" ]; then
    say "Local Node already installed ($("$NODE_DIR/bin/node" --version))"
    return
  fi

  if command -v node >/dev/null 2>&1 && [ "$(node_major node)" -ge "$MIN_NODE_MAJOR" ]; then
    say "Using the system Node ($(node --version)) — nothing to install"
    return
  fi

  local version="${NODE_VERSION:-}"
  if [ -z "$version" ]; then
    say "Resolving the current Node LTS release"
    version="$(resolve_node_version)"
  fi
  say "Installing Node $version (project-local, no sudo)"
  install_node "$version"
}

# ---------- run ----------

setup_python
setup_node

NODE_BIN="node"
[ -x "$NODE_DIR/bin/node" ] && NODE_BIN="$NODE_DIR/bin/node"

say "Running the test suite to check the toolchain"
"$NODE_BIN" --test

cat <<EOF

$(say "Ready.")

  Run the tests:     $([ "$NODE_BIN" = "node" ] && echo "node --test" || echo "$NODE_BIN --test")
  Serve the site:    ./serve.py
                     then open http://localhost:8000

  To put the local Node on your PATH for this shell:
    export PATH="$ROOT/$NODE_DIR/bin:\$PATH"

  To activate the venv:
    source $VENV_DIR/bin/activate

EOF
