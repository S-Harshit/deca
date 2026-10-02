#!/usr/bin/env bash
# Bring Deca up/down with a public tunnel.
#   ./scripts/deca.sh up       build if needed, start server + Cloudflare quick tunnel, print the URL
#   ./scripts/deca.sh up local build if needed and start only the server on this machine (no tunnel, no download)
#   ./scripts/deca.sh down     stop both (graceful)
#   ./scripts/deca.sh status   show what is running and the URL
#   ./scripts/deca.sh logs     follow server + tunnel logs
# Optional env: PORT (default 8080), ICE_SERVERS (JSON, adds a TURN relay; see docs/SPEC.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN="$ROOT/.run"
BIN="$ROOT/.bin"
PORT="${PORT:-8080}"
mkdir -p "$RUN" "$BIN"

alive() { [[ -f "$1" ]] && kill -0 "$(cat "$1")" 2>/dev/null; }

stop_pid() { # stop_pid <pidfile> <name>: SIGTERM, wait up to 5s, then SIGKILL
  local f="$1" name="$2"
  if alive "$f"; then
    local pid; pid="$(cat "$f")"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 25); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
    echo "stopped $name"
  fi
  rm -f "$f"
}

cloudflared_bin() {
  if command -v cloudflared >/dev/null 2>&1; then command -v cloudflared; return; fi
  if [[ ! -x "$BIN/cloudflared" ]]; then
    echo "downloading cloudflared..." >&2
    local arch os base="https://github.com/cloudflare/cloudflared/releases/latest/download"
    case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; *) arch=amd64 ;; esac
    case "$(uname -s)" in
      Darwin) curl -fsSL "$base/cloudflared-darwin-$arch.tgz" | tar xz -C "$BIN" cloudflared ;;
      Linux)  curl -fsSL -o "$BIN/cloudflared" "$base/cloudflared-linux-$arch" ;;
      *) echo "unsupported OS; install cloudflared manually" >&2; exit 1 ;;
    esac
    chmod +x "$BIN/cloudflared"
  fi
  echo "$BIN/cloudflared"
}

build_client() {
  local dist="$ROOT/dema-client/dist/index.html"
  if [[ ! -f "$dist" ]] || [[ -n "$(find "$ROOT/dema-client/src" "$ROOT/dema-client/index.html" "$ROOT/dema-client/vite.config.ts" -newer "$dist" 2>/dev/null | head -1)" ]]; then
    echo "building client..."
    (cd "$ROOT/dema-client" && { [[ -d node_modules ]] || npm ci; } && npm run build >/dev/null)
  fi
  [[ -d "$ROOT/dema-server/node_modules" ]] || (cd "$ROOT/dema-server" && npm ci >/dev/null)
}

cmd_up() {
  local local_only=0
  [[ "${1:-}" == "local" || -n "${LOCAL:-}" ]] && local_only=1
  if alive "$RUN/server.pid" && { [[ $local_only == 1 ]] || alive "$RUN/tunnel.pid"; }; then
    echo "already running"; cmd_status; return
  fi
  cmd_down >/dev/null  # clear any half-started leftovers

  if lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "port $PORT is in use by something else; set PORT=... or stop it" >&2; exit 1
  fi

  local cf=""
  [[ $local_only == 1 ]] || cf="$(cloudflared_bin)"
  build_client

  # Background ONE simple command so $! is node's own pid (not a wrapper subshell's).
  ( cd "$ROOT/dema-server"; PORT="$PORT" nohup node server.js >"$RUN/server.log" 2>&1 </dev/null & echo $! >"$RUN/server.pid" )
  for _ in $(seq 1 50); do curl -fs "localhost:$PORT/healthz" >/dev/null 2>&1 && break; sleep 0.2; done
  curl -fs "localhost:$PORT/healthz" >/dev/null 2>&1 || { echo "server failed to start; see .run/server.log" >&2; cmd_down >/dev/null; exit 1; }

  if [[ $local_only == 1 ]]; then
    echo
    echo "Deca is up (this machine only)"
    echo "  open: http://localhost:$PORT"
    echo "Other computers cannot join this way: browsers only allow the camera and signing keys on https or localhost."
    echo "For friends, run ./scripts/deca.sh up (public https tunnel). Stop with: ./scripts/deca.sh down"
    return
  fi

  : >"$RUN/tunnel.log"
  nohup "$cf" tunnel --no-autoupdate --url "http://localhost:$PORT" >"$RUN/tunnel.log" 2>&1 </dev/null &
  echo $! >"$RUN/tunnel.pid"

  local url=""
  for _ in $(seq 1 60); do
    url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$RUN/tunnel.log" | head -1 || true)"
    [[ -n "$url" ]] && break
    alive "$RUN/tunnel.pid" || { echo "tunnel exited; see .run/tunnel.log" >&2; cmd_down >/dev/null; exit 1; }
    sleep 0.5
  done
  [[ -n "$url" ]] || { echo "no tunnel URL after 30s; see .run/tunnel.log" >&2; cmd_down >/dev/null; exit 1; }
  echo "$url" >"$RUN/url"

  # The name shows up in the log before the tunnel is connected, so wait for the connection itself
  # (not for DNS: asking repeatedly can make your resolver remember "not found" for longer).
  for _ in $(seq 1 40); do
    grep -q "Registered tunnel connection" "$RUN/tunnel.log" && break
    alive "$RUN/tunnel.pid" || { echo "tunnel exited; see .run/tunnel.log" >&2; cmd_down >/dev/null; exit 1; }
    sleep 0.5
  done

  echo
  echo "Deca is up"
  echo "  public: $url"
  echo "  local:  http://localhost:$PORT"
  echo "A brand-new address can take up to a minute to resolve on some networks. If the page says it cannot be found, wait and reload."
  echo "Open the PUBLIC address yourself (not localhost) so invite links work for others."
  echo "Stop with: ./scripts/deca.sh down"
}

cmd_down() {
  stop_pid "$RUN/tunnel.pid" "tunnel"
  stop_pid "$RUN/server.pid" "server"
  rm -f "$RUN/url"
}

cmd_status() {
  alive "$RUN/server.pid" && echo "server: running (pid $(cat "$RUN/server.pid"), port $PORT)" || echo "server: stopped"
  alive "$RUN/tunnel.pid" && echo "tunnel: running (pid $(cat "$RUN/tunnel.pid"))" || echo "tunnel: stopped"
  [[ -f "$RUN/url" ]] && echo "url:    $(cat "$RUN/url")" || true
}

case "${1:-}" in
  up) cmd_up "${2:-}" ;;
  down) cmd_down ;;
  status) cmd_status ;;
  logs) tail -n 30 -f "$RUN/server.log" "$RUN/tunnel.log" ;;
  *) echo "usage: $0 {up [local]|down|status|logs}"; exit 1 ;;
esac
