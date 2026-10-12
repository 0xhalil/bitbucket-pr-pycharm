#!/usr/bin/env bash
# Bitbucket PR -> PyCharm helper installer (macOS).
# What it does: copies files under ~/bb-pycharm, installs the helper as a
# LaunchAgent (auto-start on login) and starts it.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/bb-pycharm"
PLIST="$HOME/Library/LaunchAgents/com.bb-pycharm.helper.plist"
UID_NUM="$(id -u)"

command -v python3 >/dev/null || { echo "ERROR: python3 not found."; exit 1; }
command -v git >/dev/null || { echo "ERROR: git not found."; exit 1; }

mkdir -p "$DEST/extension" "$HOME/Library/LaunchAgents"
cp "$SRC/pycharm-pr-helper.py" "$DEST/"
cp -r "$SRC/extension/." "$DEST/extension/"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.bb-pycharm.helper</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>python3</string>
    <string>$DEST/pycharm-pr-helper.py</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DEST/helper.log</string>
  <key>StandardErrorPath</key><string>$DEST/helper.log</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID_NUM" "$PLIST" 2>/dev/null || launchctl unload "$PLIST" 2>/dev/null || true
if launchctl bootstrap "gui/$UID_NUM" "$PLIST" 2>/dev/null; then
  echo "LaunchAgent installed."
else
  launchctl load "$PLIST"
fi

sleep 1
if curl -sf http://127.0.0.1:8765/health >/dev/null; then
  echo "OK: helper is running (http://127.0.0.1:8765)."
else
  echo "WARNING: helper failed to start, see: $DEST/helper.log"
  exit 1
fi

echo ""
echo "Final step (once, in Chrome):"
echo "  chrome://extensions > Developer mode > Load unpacked > $DEST/extension"
