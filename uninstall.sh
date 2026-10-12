#!/usr/bin/env bash
# Helper'i kaldirir (LaunchAgent + dosyalar).
set -euo pipefail
DEST="$HOME/bb-pycharm"
PLIST="$HOME/Library/LaunchAgents/com.bb-pycharm.helper.plist"
UID_NUM="$(id -u)"

launchctl bootout "gui/$UID_NUM" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
pkill -f pycharm-pr-helper 2>/dev/null || true
rm -f "$PLIST"
rm -rf "$DEST"
echo "Kaldirildi."
