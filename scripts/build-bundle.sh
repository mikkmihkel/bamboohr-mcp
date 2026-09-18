#!/usr/bin/env bash
# Builds release/bamboohr-mcp.mcpb: a Claude Desktop MCP Bundle containing the
# compiled server, its production dependencies and manifest.json.
# Usage: npm run bundle
# The mcpb CLI runs through npx at a pinned version instead of being a dev
# dependency: its interactive prompt libraries carry advisories we never ship.
set -euo pipefail
cd "$(dirname "$0")/.."

STAGE=.bundle
OUT=release/bamboohr-mcp.mcpb

npm run build
rm -rf "$STAGE"
mkdir -p "$STAGE" release
cp manifest.json package.json package-lock.json LICENSE "$STAGE/"
cp -R dist "$STAGE/dist"
rm -f "$STAGE"/dist/*.map

# Production dependencies only; the bundle must run without the dev toolchain.
(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund --silent)

npx --yes @anthropic-ai/mcpb@2.1.2 validate "$STAGE/manifest.json"
npx --yes @anthropic-ai/mcpb@2.1.2 pack "$STAGE" "$OUT"
npx --yes @anthropic-ai/mcpb@2.1.2 info "$OUT"
