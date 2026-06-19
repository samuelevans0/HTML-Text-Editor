@echo off
cd /d "%~dp0"
where node >nul 2>nul
if %errorlevel%==0 (
  echo Starting the HTML Site Editor helper...
  echo (Leave this window open while you edit. Close it or press Ctrl+C to stop.)
  node server.mjs
) else (
  echo ============================================================
  echo  Node.js was not found on this computer.
  echo ============================================================
  echo.
  echo  Option A ^(recommended^): install Node.js - it's free - from
  echo      https://nodejs.org
  echo  then double-click this file again.
  echo.
  if exist "%~dp0helper.exe" (
    echo  Option B: double-click  helper.exe  in this folder.
    echo      It's the standalone version and needs no Node.
    echo      It is unsigned, so Windows SmartScreen or your antivirus
    echo      may warn you - click "More info" then "Run anyway".
    echo      That warning is expected.
    echo.
  )
  pause
)
