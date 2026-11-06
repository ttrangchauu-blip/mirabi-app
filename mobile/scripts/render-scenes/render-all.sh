#!/usr/bin/env bash
# Renders every picture into raw/, one line per picture. What is already there is skipped, so a stopped run can go on.
cd "$(dirname "$0")"
mkdir -p raw
export LIMIT=480000
free() { for port in 9444 9445; do pid=$(netstat -ano | grep LISTENING | grep ":$port " | awk '{print $5}' | sort -u | head -1); [ -n "$pid" ] && taskkill //PID "$pid" //F //T >/dev/null 2>&1; done; }
one() { # name width height samples query
  [ -f "raw/$1.png" ] && return
  for try in 1 2 3; do
    out=$(node render.mjs stage.html "raw/$1.png" "$2" "$3" "$4" "&scene=scenes/$5" 2>&1)
    if echo "$out" | grep -q "time limit"; then rm -f "raw/$1.png"; free; fi
    if [ -f "raw/$1.png" ]; then echo "done $1 $(date +%H:%M)"; return; fi
  done
  echo "FAILED $1"
}
mask() { # name width height query: the query must not name a `light`, or that wins over the mask's
  [ -f "raw/$1.mask.png" ] && return
  for k in 2 1; do
    out=$(LIMIT=90000 node render.mjs stage.html "raw/$1.mask.png" "$(($2 * k))" "$(($3 * k))" 1 "&scene=scenes/$4&light=mask" 2>&1)
    if echo "$out" | grep -q "time limit"; then rm -f "raw/$1.mask.png"; free; fi
    [ -f "raw/$1.mask.png" ] && return
  done
  echo "FAILED mask $1"
}
for p in sakura oak sunflower bamboo maple lotus; do one "plant-$p" 2064 400 128 "scene-plants&plant=$p"; mask "plant-$p" 2064 400 "scene-plants&plant=$p"; done
one can 300 240 128 "scene-plants&plant=can"; mask can 300 240 "scene-plants&plant=can"
one garden-day 1170 1170 128 "scene-garden&light=day"; mask garden-day 1170 1170 "scene-garden"
one garden-night 1170 1170 128 "scene-garden&light=night"
one desk-day 1170 708 192 "scene-desk&light=day"
one desk-night 1170 708 192 "scene-desk&light=night"
one desktop 900 900 96 "scene-desktop"
one lib-wall 900 900 96 "scene-library&part=wall"
one lib-niche 1110 480 192 "scene-library&part=niche"
one lib-books 2112 366 192 "scene-library&part=books"; mask lib-books 2112 366 "scene-library&part=books"
one lib-tops 900 300 160 "scene-library&part=tops"; mask lib-tops 900 300 "scene-library&part=tops"
one hall-room 1170 2100 64 "scene-hall&part=room"
one hall-board 1050 520 160 "scene-hall&part=board"; mask hall-board 1050 520 "scene-hall&part=board"
one hall-table 1170 270 160 "scene-hall&part=table"; mask hall-table 1170 270 "scene-hall&part=table"
one stones 1200 255 160 "scene-career&biome=stones"; mask stones 1200 255 "scene-career&biome=stones"
one hedge 1170 210 128 "scene-career&biome=hedge"; mask hedge 1170 210 "scene-career&biome=hedge"
for b in 0 1 2 3 4 5; do one "land-$b" 900 900 128 "scene-career&biome=$b"; done
one town-lantern 120 240 96 "scene-town&part=lantern"; mask town-lantern 120 240 "scene-town&part=lantern"
mask street 1600 550 "scene-street&lots=none"
for light in day night; do for lots in none odd even; do one "street-$lots-$light" 1600 550 "$([ $light = day ] && echo 160 || echo 220)" "scene-street&lots=$lots&light=$light"; done; done
# Thị trấn Mirabi: the street in four tiles (too long for one texture), and a pass for each stage and each friend's plot.
mkdir -p raw/townstreet
mask townstreet/mask 6000 720 "scene-townstreet"
[ -f raw/townstreet/mask.mask.png ] && mv raw/townstreet/mask.mask.png raw/townstreet/mask.png
for light in day night; do
  S=$([ $light = day ] && echo 120 || echo 160)
  for t in 0 1 2 3; do one "townstreet/land-$light-$t" 1500 720 $S "scene-townstreet&light=$light&crop=$((t * 1500)),0,1500,720"; done
  for k in 1 2 3 4; do one "townstreet/fountain-$k-$light" 720 620 $S "scene-townstreet&light=$light&fountain=$k&crop=0,100,720,620"; done
  for k in 1 2 3 4; do one "townstreet/garden-$k-$light" 680 620 $S "scene-townstreet&light=$light&garden=$k&crop=560,100,680,620"; done
  for i in 0 1 2 3 4 5 6 7 8 9 10 11; do
    x=$(awk -v i=$i 'BEGIN { x = int((15.65 + i * 1.83) / 37 * 6000 - 300); print (x > 5400 ? 5400 : x) }')
    one "townstreet/house-$i-$light" 600 580 $S "scene-townstreet&light=$light&lots=$i&crop=$x,140,600,580"
  done
done
# These masks are the size of their pictures, as the cut scripts expect.
# Khám phá: three layers in tiles (a whole 1950 square hangs at the screenshot). Their upper tiles are nearly empty, and that is right.
mkdir -p raw/road
for p in far mid road; do
  one "road/$p.mask" 1950 1950 1 "scene-road&part=$p&light=mask"
  for light in day night; do S=$([ $light = day ] && echo 110 || echo 150)
    i=0; for y in 0 975; do for x in 0 975; do one "road/$p-$light-$i" 975 975 $S "scene-road&part=$p&light=$light&crop=$x,$y,975,975"; i=$((i + 1)); done; done
  done
done
# Học tập and Vườn tài chính.
mkdir -p raw/learn raw/orchard
one learn/school.mask 1170 540 1 "scene-school&light=mask"
one learn/trail.mask 1170 1755 1 "scene-trail&light=mask"
one learn/stones.mask 1440 240 1 "scene-trail&part=stones&light=mask"
for light in day night; do S=$([ $light = day ] && echo 110 || echo 150)
  one "learn/school-$light" 1170 540 $S "scene-school&light=$light"
  one "learn/trail-$light" 1170 1755 $S "scene-trail&light=$light"
  one "learn/stones-$light" 1440 240 $S "scene-trail&part=stones&light=$light"
  one "orchard/$light" 1476 1116 $S "scene-orchard&light=$light"
done
one orchard/mask 1476 1116 1 "scene-orchard&light=mask"
# Nhiệm vụ công việc.
mkdir -p raw/work
one work/sea 1170 450 90 "scene-isles&part=sea&light=day"
for i in 0 1 2; do one "work/chest-$i.mask" 360 360 1 "scene-isles&part=chests&state=$i&light=mask"; one "work/chest-$i" 360 360 120 "scene-isles&part=chests&state=$i&light=day"; done
for th in meadow beach forest snow desert sky; do one "work/isle-$th.mask" 1440 300 1 "scene-isles&part=isles&theme=$th&light=mask"; one "work/isle-$th" 1440 300 120 "scene-isles&part=isles&theme=$th&light=day"; done
# The games' worlds.
mkdir -p raw/games
for w in forest cave castle boss; do for l in far mid near; do one "games/$w-$l.mask" 1170 660 1 "scene-games&world=$w&layer=$l&light=mask"; one "games/$w-$l" 1170 660 90 "scene-games&world=$w&layer=$l&light=day"; done; done
for l in far near; do one "games/space-$l.mask" 1170 660 1 "scene-games&world=space&layer=$l&light=mask"; one "games/space-$l" 1170 660 90 "scene-games&world=space&layer=$l&light=day"; done
one games/field.mask 1170 660 1 "scene-games&world=field&light=mask"
one games/brook.mask 960 320 1 "scene-games&world=brook&light=mask"; one games/brook 960 320 100 "scene-games&world=brook&light=day"
for w in stone bronze feudal modern map lab field; do one "games/$w" 1170 660 100 "scene-games&world=$w&light=day"; done
echo ALL-DONE
