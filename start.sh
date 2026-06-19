#!/bin/sh
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then
  echo "Starting the HTML Site Editor helper..."
  echo "(Leave this window open while you edit. Press Ctrl+C to stop.)"
  node server.mjs
else
  echo "============================================================"
  echo " Node.js was not found on this computer."
  echo "============================================================"
  echo
  echo " Install Node.js (free) from https://nodejs.org,"
  echo " then run this again."
  echo
  echo " (On macOS/Linux there's no prebuilt standalone binary -"
  echo "  installing Node, or just using Chrome/Edge, are the options.)"
  echo
  printf "Press Enter to close..."
  read _
fi
