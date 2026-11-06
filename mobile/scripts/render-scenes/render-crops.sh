#!/usr/bin/env bash
# Vườn nhà's plants (scene-crops.js), five stages each, into raw/crops: a day picture, a night picture and a mask per plant.
# `bash render-crops.sh draft` makes quick day pictures only (raw/crops-draft), to look at before the real run.
# What is already there is skipped, so a stopped run goes on where it was. Prints one line per picture with the time.
cd "$(dirname "$0")"
PLANTS="carrot daisy lettuce tomato potato sunflower succulent seedling strawberry tulip lavender blueberry grape pumpkin cherry_blossom golden_apple crystal_tree blue_rose moonflower mist_tree frost_tree fire_tree rainbow_flower starlight_tree light_tree time_tree myth_tree galaxy_tree ancient_tree"
[ -n "$ONLY" ] && PLANTS="$ONLY"
free() { for port in 9444 9445; do pid=$(netstat -ano | grep LISTENING | grep ":$port " | awk '{print $5}' | sort -u | head -1); [ -n "$pid" ] && taskkill //PID "$pid" //F //T >/dev/null 2>&1; done; }
one() { # out width height samples query
  [ -f "$1" ] && return
  for try in 1 2 3; do
    out=$(LIMIT=${LIMIT:-600000} node render.mjs stage.html "$1" "$2" "$3" "$4" "$5" 2>&1)
    if echo "$out" | grep -q "time limit"; then rm -f "$1"; free; fi
    if [ -f "$1" ]; then echo "done $1 $(date +%H:%M:%S)"; return; fi
    echo "$out" | grep -E "ERR" | head -2
    free; sleep 3
  done
  echo "FAILED $1"
}
mask() { # out width height query: the query must not name a light, or that wins over the mask's
  [ -f "$1" ] && return
  for try in 1 2; do
    LIMIT=120000 node render.mjs stage.html "$1" "$2" "$3" 1 "$4&light=mask" >/dev/null 2>&1
    if [ -f "$1" ]; then echo "done $1 $(date +%H:%M:%S)"; return; fi
    free; sleep 3
  done
  echo "FAILED $1"
}
echo "start $(date +%H:%M:%S)"
if [ "$1" = "draft" ]; then
  mkdir -p raw/crops-draft
  for p in $PLANTS; do one "raw/crops-draft/$p.png" 1500 420 ${SAMPLES:-12} "&scene=scenes/scene-crops&plant=$p&light=day"; done
else
  mkdir -p raw/crops
  for p in $PLANTS; do
    mask "raw/crops/$p.mask.png" 3000 840 "&scene=scenes/scene-crops&plant=$p"
    one "raw/crops/$p-day.png" 1500 420 ${SAMPLES:-96} "&scene=scenes/scene-crops&plant=$p&light=day"
    one "raw/crops/$p-night.png" 1500 420 ${SAMPLES:-64} "&scene=scenes/scene-crops&plant=$p&light=night"
  done
fi
echo "finished $(date +%H:%M:%S)"
