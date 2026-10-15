#!/usr/bin/env bash
# Register native/opus-host.mjs as a native messaging host for Chrome, Brave,
# Chromium and Firefox (desktop), so the "Ask Opus" button can reach the
# local Claude Code CLI.
#
#   ./native/install.sh [chrome-extension-id]
#
# The id defaults to the one Chrome derives for an unpacked extension loaded
# from this repo; check it on chrome://extensions if Opus reports
# "Access to the specified native messaging host is forbidden".
set -euo pipefail
cd "$(dirname "$0")"

NAME="de.zehntage.opus"
HOST="$PWD/opus-host.mjs"
GECKO_ID="zehntage@lykd"
# Unpacked id = first 32 hex chars of sha256(absolute path), digits mapped 0-f → a-p.
EXT_ID="${1:-$(printf '%s' "$(dirname "$PWD")" | sha256sum | cut -c1-32 | tr '0-9a-f' 'a-p')}"

chmod +x "$HOST"

for dir in ~/.config/google-chrome/NativeMessagingHosts ~/.config/chromium/NativeMessagingHosts \
  ~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts; do
  mkdir -p "$dir"
  cat >"$dir/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "ZehnTage: Ask Opus via Claude Code CLI",
  "path": "$HOST",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$EXT_ID/"]
}
EOF
  echo "wrote $dir/$NAME.json (extension $EXT_ID)"
done

dir=~/.mozilla/native-messaging-hosts
mkdir -p "$dir"
cat >"$dir/$NAME.json" <<EOF
{
  "name": "$NAME",
  "description": "ZehnTage: Ask Opus via Claude Code CLI",
  "path": "$HOST",
  "type": "stdio",
  "allowed_extensions": ["$GECKO_ID"]
}
EOF
echo "wrote $dir/$NAME.json"
