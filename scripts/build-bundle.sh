#!/usr/bin/env bash
# Builds release/bamboohr-mcp.mcpb: a Claude Desktop MCP Bundle containing the
# compiled server, its production dependencies, manifest.json and the icon, plus
# release/SHA256SUMS. Usage: npm run bundle
#
# Supply chain notes:
# - Dependencies are installed from the committed lockfile with scripts disabled.
# - The mcpb CLI is an exact-pinned devDependency resolved from the lockfile and
#   run with `npm exec --no`, so nothing is fetched at build time and it is
#   never part of the shipped bundle or of the runtime config.
# - Official releases are built by .github/workflows/release.yml, which also
#   signs the bundle with Sigstore and attaches build provenance.
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE=.bundle
OUT=release/bamboohr-mcp.mcpb

npm run build
rm -rf "$STAGE"
mkdir -p "$STAGE" release
cp manifest.json package.json package-lock.json LICENSE "$STAGE/"
cp assets/icon.png "$STAGE/icon.png"
cp -R dist "$STAGE/dist"
find "$STAGE/dist" -name "*.map" -delete

# Production dependencies only; the bundle must run without the dev toolchain.
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent)

npm exec --no -- mcpb validate "$STAGE/manifest.json"
npm exec --no -- mcpb pack "$STAGE" "$OUT"
npm exec --no -- mcpb info "$OUT"

(cd release && sha256sum bamboohr-mcp.mcpb > SHA256SUMS && cat SHA256SUMS)
