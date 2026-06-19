#!/bin/sh
# Start the HTML Site Editor helper. Leave this running while you edit.
cd "$(dirname "$0")"
echo "Starting the HTML Site Editor helper..."
echo "(Leave this window open while you edit. Press Ctrl+C to stop.)"
node server.mjs
