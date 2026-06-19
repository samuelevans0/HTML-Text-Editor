@echo off
cd /d "%~dp0"
echo Starting the HTML Site Editor helper...
echo (Leave this window open while you edit. Close it or press Ctrl+C to stop.)
node server.mjs
pause
