#!/usr/bin/env bash
set -euo pipefail
cd "/Users/sanysach/Documents/Weekend Roster"
mkdir -p logs
{
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Starting NA proof export"
  /Users/sanysach/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/cutoff-ops.mjs proof
  echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] NA proof export completed"
} >> logs/cutoff-proof.log 2>&1
launchctl bootout "gui/$(id -u)" "/Users/sanysach/Library/LaunchAgents/com.weekendroster.cutoff-proof.plist" >/dev/null 2>&1 || true
rm -f "/Users/sanysach/Library/LaunchAgents/com.weekendroster.cutoff-proof.plist"
