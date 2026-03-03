#!/bin/bash
# Installs native messaging host for ZehnTage Chrome extension.
# Usage: ./install.sh <extension-id>
#   Get the extension ID from chrome://extensions after loading unpacked.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: $0 <extension-id>"
  echo "  Get the ID from chrome://extensions (Developer Mode → Load Unpacked)"
  exit 1
fi

EXT_ID="$1"
HOST_NAME="com.zehntage.host"
HOST_PATH="$(cd "$(dirname "$0")" && pwd)/zehntage_host.py"

# Detect browser config directory
if [ -d "$HOME/.config/google-chrome" ]; then
  MANIFEST_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
elif [ -d "$HOME/.config/chromium" ]; then
  MANIFEST_DIR="$HOME/.config/chromium/NativeMessagingHosts"
else
  echo "Error: Neither Chrome nor Chromium config directory found."
  exit 1
fi

mkdir -p "$MANIFEST_DIR"

cat > "$MANIFEST_DIR/$HOST_NAME.json" <<EOF
{
  "name": "$HOST_NAME",
  "description": "ZehnTage file I/O",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF

chmod +x "$HOST_PATH"

echo "Installed native messaging host."
echo "  Host: $HOST_PATH"
echo "  Manifest: $MANIFEST_DIR/$HOST_NAME.json"
echo "  Extension ID: $EXT_ID"
echo "Restart Chrome to activate."
