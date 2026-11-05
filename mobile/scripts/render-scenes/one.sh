#!/usr/bin/env bash
# one.sh <out.png> <w> <h> <samples> <query> : one picture, tried again if the browser falls over.
out="$1"; w="$2"; h="$3"; s="$4"; q="$5"
free() { for port in 9444 9445; do pid=$(netstat -ano | grep LISTENING | grep ":$port " | awk '{print $5}' | sort -u | head -1); [ -n "$pid" ] && taskkill //PID "$pid" //F //T >/dev/null 2>&1; done; }
for try in 1 2 3 4; do
  rm -f "$out"
  log=$(LIMIT=${LIMIT:-900000} node render.mjs stage.html "$out" "$w" "$h" "$s" "$q" 2>&1)
  if echo "$log" | grep -q "time limit"; then rm -f "$out"; free; fi
  if [ -f "$out" ]; then echo "$log" | grep -E "^rect" | grep -v undefined; echo "done $out $(date +%H:%M:%S)"; exit 0; fi
  echo "$log" | grep -E "ERR|LOG" | grep -v favicon | head -3
  free; sleep 4
done
echo "FAILED $out"; exit 1
