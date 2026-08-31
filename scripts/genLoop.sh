#!/usr/bin/env bash
cd "$(dirname "$0")/.."
LOG=scripts/gen.log
: > "$LOG"
for i in $(seq 1 60); do
  echo "===== pass $i $(date +%H:%M:%S) =====" >> "$LOG"
  node scripts/genLanduse.mjs >> "$LOG" 2>&1
  n=$(ls public/data/landuse/*.geojson 2>/dev/null | wc -l)
  echo "---- after pass $i: $n/70 files ----" >> "$LOG"
  [ "$n" -ge 70 ] && { echo "ALL DONE" >> "$LOG"; break; }
  sleep 20
done
