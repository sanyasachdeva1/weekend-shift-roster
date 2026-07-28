#!/usr/bin/env bash
set -euo pipefail
cd "/Users/sanysach/Documents/Weekend Roster"
mkdir -p logs
{
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Starting roster generation"
  /Users/sanysach/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/cutoff-ops.mjs generate
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Roster generation completed"
} >> logs/cutoff-generate.log 2>&1
launchctl bootout "gui/$(id -u)" "/Users/sanysach/Library/LaunchAgents/com.weekendroster.cutoff-generate.plist" >/dev/null 2>&1 || true
rm -f "/Users/sanysach/Library/LaunchAgents/com.weekendroster.cutoff-generate.plist"
