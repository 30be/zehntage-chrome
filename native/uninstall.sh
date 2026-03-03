#!/bin/bash
# Removes the native messaging host for ZehnTage Chrome extension.

set -euo pipefail

HOST_NAME="com.zehntage.host"

for dir in "$HOME/.config/google-chrome/NativeMessagingHosts" "$HOME/.config/chromium/NativeMessagingHosts"; do
  if [ -f "$dir/$HOST_NAME.json" ]; then
    rm "$dir/$HOST_NAME.json"
    echo "Removed $dir/$HOST_NAME.json"
  fi
done

echo "Uninstalled. Restart Chrome."
