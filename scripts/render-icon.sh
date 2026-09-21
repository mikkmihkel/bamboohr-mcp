#!/usr/bin/env bash
# Renders assets/icon.svg to assets/icon.png (512x512, transparent) with the
# Playwright Chromium headless shell when present, else with any Chromium/Chrome
# on PATH. Usage: bash scripts/render-icon.sh
set -euo pipefail
cd "$(dirname "$0")/.."

BROWSER="${CHROMIUM_BIN:-}"
if [ -z "$BROWSER" ]; then
  for c in /opt/pw-browsers/chromium_headless_shell-*/chrome-linux/headless_shell chromium chromium-browser google-chrome; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then BROWSER="$c"; break; fi
  done
fi
[ -n "$BROWSER" ] || { echo "No Chromium found; set CHROMIUM_BIN" >&2; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp assets/icon.svg "$TMP/icon.svg"
cat > "$TMP/render.html" <<'HTML'
<!doctype html><html><head><style>html,body{margin:0;padding:0;width:512px;height:512px;overflow:hidden;background:transparent}img{display:block;width:512px;height:512px}</style></head><body><img src="icon.svg"></body></html>
HTML
"$BROWSER" --headless --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --default-background-color=00000000 --window-size=512,512 \
  --screenshot="$PWD/assets/icon.png" "file://$TMP/render.html" >/dev/null 2>&1
echo "wrote assets/icon.png"
