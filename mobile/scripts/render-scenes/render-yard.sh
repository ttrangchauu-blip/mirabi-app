#!/usr/bin/env bash
# The home garden's pictures, into raw/yard. What is already there is skipped, so a stopped run goes on where it was.
cd "$(dirname "$0")"
mkdir -p raw/yard
export LIMIT=1500000
free() { for port in 9444 9445; do pid=$(netstat -ano | grep LISTENING | grep ":$port " | awk '{print $5}' | sort -u | head -1); [ -n "$pid" ] && taskkill //PID "$pid" //F //T >/dev/null 2>&1; done; }
one() { # name width height samples query
  [ -f "raw/yard/$1.png" ] && return
  for try in 1 2 3; do
    out=$(node render.mjs stage.html "raw/yard/$1.png" "$2" "$3" "$4" "&scene=scenes/$5" 2>&1)
    if echo "$out" | grep -q "time limit"; then rm -f "raw/yard/$1.png"; free; fi
    if [ -f "raw/yard/$1.png" ]; then echo "done $1 $(date +%H:%M)"; return; fi
  done
  echo "FAILED $1"
}
mask() { # name width height query: the query must not name a light, or that wins over the mask's
  [ -f "raw/yard/$1.mask.png" ] && return
  for k in 2 1; do
    out=$(LIMIT=120000 node render.mjs stage.html "raw/yard/$1.mask.png" "$(($2 * k))" "$(($3 * k))" 1 "&scene=scenes/$4&light=mask" 2>&1)
    if echo "$out" | grep -q "time limit"; then rm -f "raw/yard/$1.mask.png"; free; fi
    if [ -f "raw/yard/$1.mask.png" ]; then echo "done mask $1 $(date +%H:%M)"; return; fi
  done
  echo "FAILED mask $1"
}
echo "start $(date +%H:%M)"
for b in dry wet; do for l in day night; do one "bed-$b-$l" 640 320 96 "scene-beds&bed=$b&light=$l"; done; mask "bed-$b" 640 320 "scene-beds&bed=$b"; done
for l in day night; do one "clouds-$l" 1440 480 96 "scene-clouds&light=$l"; done; mask clouds 1440 480 "scene-clouds"
mask yard 1000 1500 "scene-yard&still=1"
for p in treeL treeR blossom flowersL flowersR; do mask "$p" 1000 1500 "scene-yard&only=$p"; done
one yard-day 1000 1500 96 "scene-yard&light=day"
one yard-still-day 1000 1500 96 "scene-yard&still=1&light=day"
one yard-night 1000 1500 64 "scene-yard&light=night"
one yard-still-night 1000 1500 64 "scene-yard&still=1&light=night"
echo "finished $(date +%H:%M)"
