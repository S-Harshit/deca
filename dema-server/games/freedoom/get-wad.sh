#!/usr/bin/env bash
# Fetches Freedoom's game data (BSD licensed, free to redistribute) next to index.html.
set -euo pipefail
cd "$(dirname "$0")"
curl -fL -o /tmp/freedoom.zip "https://github.com/freedoom/freedoom/releases/download/v0.13.0/freedoom-0.13.0.zip"
unzip -o -j /tmp/freedoom.zip "*/freedoom1.wad" "*/COPYING.txt" "*/CREDITS.txt" -d .
mv -f COPYING.txt LICENSE-Freedoom.txt; mv -f CREDITS.txt CREDITS-Freedoom.txt
rm /tmp/freedoom.zip
echo "Done: freedoom1.wad is in place."
