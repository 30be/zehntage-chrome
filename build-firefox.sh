#!/usr/bin/env bash
# Build the Firefox (.xpi) from the Chrome MV3 source — non-destructive.
# Staging lives in build/firefox/, the artifact in dist/.
#
#   ./build-firefox.sh            # build unsigned xpi (sideload on a fork / web-ext run)
#   ./build-firefox.sh sign       # build + sign UNLISTED via AMO (needs the env vars below)
#
# Signing needs Mozilla add-on API credentials from
#   https://addons.mozilla.org/developers/addon/api/key/
#   export AMO_JWT_ISSUER=user:xxxxx:123
#   export AMO_JWT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
set -euo pipefail
cd "$(dirname "$0")"

GECKO_ID="zehntage@lykd"

rm -rf build/firefox dist
mkdir -p build/firefox dist
cp background.js content.js content.css build/firefox/
cp -r icons popup build/firefox/

python3 - "$GECKO_ID" <<'PY'
import json, sys
gid = sys.argv[1]
m = json.load(open('manifest.json'))
# Firefox MV3 uses an event-page background, not a service worker.
m['background'] = {'scripts': ['background.js']}
m['browser_specific_settings'] = {
    'gecko': {'id': gid, 'data_collection_permissions': {'required': ['none']}}
}
json.dump(m, open('build/firefox/manifest.json', 'w'), indent=2, ensure_ascii=False)
PY

python3 - <<'PY'
import zipfile, os
root, out = 'build/firefox', 'dist/zehntage-firefox-0.1.0.xpi'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for dp, _, fs in os.walk(root):
        for f in sorted(fs):
            full = os.path.join(dp, f)
            z.write(full, os.path.relpath(full, root))
print('Unsigned xpi:', out)
PY

if [ "${1:-}" = "sign" ]; then
  : "${AMO_JWT_ISSUER:?set AMO_JWT_ISSUER}"
  : "${AMO_JWT_SECRET:?set AMO_JWT_SECRET}"
  npx --yes web-ext sign \
    --source-dir build/firefox \
    --channel=unlisted \
    --api-key="$AMO_JWT_ISSUER" \
    --api-secret="$AMO_JWT_SECRET" \
    --artifacts-dir=dist
  echo "Signed xpi is in dist/ (look for the *.xpi AMO returned)."
fi
