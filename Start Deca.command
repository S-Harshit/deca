#!/bin/bash
# Double-click this file on a Mac to start Deca.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "Deca needs a free program called Node.js first."
  echo "Opening the download page. Install it (click Continue a few times),"
  echo "then double-click this file again."
  open "https://nodejs.org/en/download" 2>/dev/null
  echo
  read -r -n 1 -s -p "Press any key to close this window."
  exit 1
fi
node scripts/start.mjs
echo
read -r -n 1 -s -p "Deca has stopped. Press any key to close this window."
