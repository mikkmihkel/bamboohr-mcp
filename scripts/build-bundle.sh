#!/usr/bin/env bash
# Builds release/bamboohr-mcp.mcpb: a Claude Desktop MCP Bundle containing the
# compiled server, its production dependencies, manifest.json and the icon, plus
# release/SHA256SUMS. Usage: npm run bundle
#
# Supply chain notes:
# - Dependencies are installed from the committed lockfile with scripts disabled.
# - The mcpb CLI runs at build time only, through npx at a pinned version, and is
#   never part of the shipped bundle or of the runtime config. It is not a dev
#   dependency because its interactive prompt libraries carry advisories we
#   never want in node_modules.
# - Official releases are built by .github/workflows/release.yml, which also
#   signs the bundle with Sigstore and attaches build provenance.
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE=.bundle
OUT=release/bamboohr-mcp.mcpb
MCPB_VERSION=2.1.2

npm run build
rm -rf "$STAGE"
mkdir -p "$STAGE" release
cp manifest.json package.json package-lock.json LICENSE "$STAGE/"
cp assets/icon.png "$STAGE/icon.png"
cp -R dist "$STAGE/dist"
rm -f "$STAGE"/dist/*.map

# Production dependencies only; the bundle must run without the dev toolchain.
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent)

npx --yes "@anthropic-ai/mcpb@$MCPB_VERSION" validate "$STAGE/manifest.json"
npx --yes "@anthropic-ai/mcpb@$MCPB_VERSION" pack "$STAGE" "$OUT"
npx --yes "@anthropic-ai/mcpb@$MCPB_VERSION" info "$OUT"

(cd release && sha256sum bamboohr-mcp.mcpb > SHA256SUMS && cat SHA256SUMS)
