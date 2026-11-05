#!/usr/bin/env bash
# Vườn tài chính's pictures, into raw/grove. What is already there is skipped, so a stopped run goes on where it was. About an hour on an integrated GPU.
# A page 4032 wide hangs at the screenshot, so the plants' sheets are rendered in tiles of the same camera (`&fw&fh&ox`) and joined by join-tiles.mjs.
cd "$(dirname "$0")"
mkdir -p raw/grove/tiles
export LIMIT=1200000
one() { [ -f "raw/grove/$1.png" ] && return; bash one.sh "raw/grove/$1.png" "$2" "$3" "$4" "&scene=scenes/$5"; sleep 3; }
mask() { [ -f "raw/grove/$1.mask.png" ] && return; LIMIT=180000 bash one.sh "raw/grove/$1.mask.png" "$2" "$3" 1 "&scene=scenes/$4&light=mask"; sleep 3; }
# A sheet of six cells 672 x 600: two tiles of three.
sheet() { # name query light
  [ -f "raw/grove/$1.png" ] && return
  for t in 0 1; do
    f="raw/grove/tiles/$1-$t.png"
    [ -f "$f" ] || { bash one.sh "$f" 2016 600 64 "&scene=scenes/$2&light=${3:-day}&fw=4032&fh=600&ox=$((t * 2016))"; sleep 3; }
  done
  node join-tiles.mjs "raw/grove/$1.png" 2 2016 600 raw/grove/tiles/$1-0.png raw/grove/tiles/$1-1.png
}
# Its mask at twice the size, three tiles of two cells.
sheetmask() { # name query
  [ -f "raw/grove/$1.mask.png" ] && return
  for t in 0 1 2; do
    f="raw/grove/tiles/$1-m$t.png"
    [ -f "$f" ] || { LIMIT=180000 bash one.sh "$f" 2688 1200 1 "&scene=scenes/$2&light=mask&fw=8064&fh=1200&ox=$((t * 2688))"; sleep 2; }
  done
  node join-tiles.mjs "raw/grove/$1.mask.png" 3 2688 1200 raw/grove/tiles/$1-m0.png raw/grove/tiles/$1-m1.png raw/grove/tiles/$1-m2.png
}
echo "start $(date +%H:%M:%S)"
one vale-day 1400 700 96 "scene-vale&light=day"
one vale-night 1400 700 64 "scene-vale&light=night"
mask vale 2800 1400 "scene-vale"
one meadow-day 1180 528 96 "scene-meadow&light=day"
one meadow-night 1180 528 64 "scene-meadow&light=night"
for l in day night; do one "sails-$l" 360 360 64 "scene-vale&sails=1&light=$l"; done; mask sails 720 720 "scene-vale&sails=1"
for l in day night; do one "sign-$l" 700 460 96 "scene-gardenparts&part=sign&light=$l"; done; mask sign 1400 920 "scene-gardenparts&part=sign"
for l in day night; do one "bloom-$l" 1200 420 64 "scene-gardenparts&part=bloom&light=$l"; done; mask bloom 2400 840 "scene-gardenparts&part=bloom"
one icons 1600 200 96 "scene-gardenparts&part=icons&light=day"; mask icons 3200 400 "scene-gardenparts&part=icons"
for l in day night; do n=""; [ $l = night ] && n="-night"; sheet "none$n" "scene-grove&pass=none" $l; sheet "soil$n" "scene-grove&pass=soil" $l; sheet "water$n" "scene-grove&pass=water" $l; done
for p in sakura oak sunflower bamboo maple lotus; do
  sheet "$p" "scene-grove&plant=$p"
  sheet "$p-night" "scene-grove&plant=$p" night
  sheetmask "$p" "scene-grove&plant=$p"
done
echo "finished $(date +%H:%M:%S)"
