@echo off
title Elite Frame Finder server (keep this window open)
cd /d "%~dp0"
echo Starting Elite Frame Finder...
echo Keep this window open while the tablet is in use. Close it to stop the server.
echo.
start "" http://localhost:4100/connect.html
:loop
node server.js
echo.
echo Server stopped (exit code %errorlevel%). Restarting in 3 seconds... Press Ctrl+C to quit.
timeout /t 3 /nobreak >nul
goto loop
