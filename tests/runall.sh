#!/bin/bash
cd /tmp/claude-0/-home-user-itsu/843237ee-b763-567a-aa2e-8be0fb208083/scratchpad
for t in test-carousel test-tile test-chooser test-dock test-undo test-reorder test-swipe test-fastswipe \
         test-haptics test-dock-haptics test-cover test-share test-pwa test-iframe test-library \
         test-pagesbar test-dragroom test-installbar test-update test-photodates test-thumbupgrade; do
  out=$(timeout 400 node $t.mjs 2>&1)
  bad=$(printf '%s\n' "$out" | grep -c '✗')
  err=$(printf '%s\n' "$out" | grep -i "^errors:" | grep -vc "none")
  printf '%-22s ✗=%-3s errline=%s\n' "$t" "$bad" "$err"
  printf '%s\n' "$out" > "run-$t.log"
done
echo ALLDONE
