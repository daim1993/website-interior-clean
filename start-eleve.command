#!/usr/bin/env bash
cd "$(dirname "$0")/server" || exit 1
command -v node >/dev/null 2>&1 || { echo 'Install Node.js from https://nodejs.org then re-run.'; exit 1; }
[ -d node_modules ] || npm install
( sleep 2; (open http://localhost:4000 2>/dev/null || xdg-open http://localhost:4000 2>/dev/null) ) &
echo 'Eleve running at http://localhost:4000  (Ctrl+C to stop)'
node server.js
