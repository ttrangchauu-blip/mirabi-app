#!/usr/bin/env bash
# The valley of Kham pha, into raw/wild. What is already there is skipped, so a stopped run goes on where it was. Big layers are rendered in four columns: wider ones can hang the screenshot of Chrome.
cd "$(dirname "$0")"
mkdir -p raw/wild
export LIMIT=1500000
FW=3080; FH=1400
free() { for port in ${PORT_A:-9444} ${PORT_B:-9445}; do pid=$(netstat -ano | grep LISTENING | grep ":$port " | awk '{print $5}' | sort -u | head -1); [ -n "$pid" ] && taskkill //PID "$pid" //F //T >/dev/null 2>&1; done; return 0; }
pass() { # name width height samples query
  [ -f "raw/wild/$1.png" ] && return
  for try in 1 2 3 4; do
    out=$(node render.mjs stage.html "raw/wild/$1.png" "$2" "$3" "$4" "&scene=scenes/scene-wild$5" 2>&1 < /dev/null)
    if echo "$out" | grep -q "time limit"; then rm -f "raw/wild/$1.png"; fi
    if [ -f "raw/wild/$1.png" ]; then echo "done $1 $(date +%H:%M)"; return; fi
    free; echo "retry $1 $(date +%H:%M)"
  done
  echo "FAILED $1"
}
mask() { # name query: full size, one sample. The query must not name a light.
  [ -f "raw/wild/$1.mask.png" ] && return
  for try in 1 2 3; do
    out=$(LIMIT=240000 node render.mjs stage.html "raw/wild/$1.mask.png" $FW $FH 1 "&scene=scenes/scene-wild$2&light=mask" 2>&1 < /dev/null)
    if echo "$out" | grep -q "time limit"; then rm -f "raw/wild/$1.mask.png"; fi
    if [ -f "raw/wild/$1.mask.png" ]; then echo "done mask $1 $(date +%H:%M)"; return; fi
    free; echo "retry mask $1 $(date +%H:%M)"
  done
  echo "FAILED mask $1"
}
tiles() { # name samples query top height
  local col=$((FW / 4))
  for i in 0 1 2 3; do pass "$1-$i" $col "$5" "$2" "$3&fw=$FW&fh=$FH&crop=$((col * i)),$4,$col,$5"; done
}
echo "start $(date +%H:%M)"
# The road as the camera sees it, for the feet of the pet.
for s in 0 1 2; do [ -s "raw/wild/road$s.txt" ] || { LIMIT=240000 node render.mjs stage.html raw/wild/road.png 440 200 1 "&scene=scenes/scene-wild&part=far&seg=$s&light=mask" 2>&1 < /dev/null | grep '^rect' > "raw/wild/road$s.txt"; free; echo "done road $s $(date +%H:%M)"; }; done
mask far "&part=far"
for h in 0 1; do mask "mid$h" "&part=mid&hill=$h"; for t in t1 t2 t3; do mask "h$h$t" "&only=$t&hill=$h"; done; done
for s in 0 1 2; do mask "land$s" "&part=land&seg=$s"; done
for f in 0 1; do mask "near$f" "&part=near&front=$f"; done
for l in day night; do
  n=48; [ $l = night ] && n=32
  pass "far-$l" 1540 700 $n "&part=far&light=$l"
  for f in 0 1; do tiles "near$f-$l" $n "&part=near&front=$f&light=$l" 980 420; done
  for h in 0 1; do
    tiles "mid$h-$l" $n "&part=mid&hill=$h&light=$l" 70 630
    tiles "midstill$h-$l" 32 "&part=mid&hill=$h&still=1&light=$l" 70 630
  done
  for s in 0 1 2; do tiles "land$s-$l" $n "&part=land&seg=$s&light=$l" 392 1008; done
done
echo "finished $(date +%H:%M)"
