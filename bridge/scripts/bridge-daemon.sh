#!/bin/zsh
# Manage the Even bridge as a macOS launchd LaunchAgent (auto-start on login,
# auto-restart on crash). Usage:
#   ./scripts/bridge-daemon.sh install|uninstall|restart|status|logs
#
# The agent inherits your current PATH at install time, so tmux / whisper /
# ffmpeg / node are all found. config.json / .env in the bridge dir are used.
set -e

BRIDGE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.evenclaude.bridge"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE="$(command -v node)"
LOG="$BRIDGE_DIR/daemon.log"

case "$1" in
install)
  if [ -z "$NODE" ]; then echo "node not found on PATH"; exit 1; fi
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--import</string>
    <string>tsx</string>
    <string>src/index.ts</string>
  </array>
  <key>WorkingDirectory</key><string>$BRIDGE_DIR</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$PATH</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLISTEOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "installed & started: $LABEL"
  echo "logs: $LOG"
  ;;
uninstall)
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "removed: $LABEL"
  ;;
restart)
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load "$PLIST"
  echo "restarted: $LABEL"
  ;;
status)
  if launchctl list | grep -q "$LABEL"; then
    launchctl list | grep "$LABEL"
    echo "running"
  else
    echo "not loaded"
  fi
  ;;
logs)
  tail -n 40 -f "$LOG"
  ;;
*)
  echo "usage: $0 {install|uninstall|restart|status|logs}"
  exit 1
  ;;
esac
