@echo off
title LIMRA Restaurant POS — Local Thermal Printer Bridge (TVS RP 3200 Plus)
color 0A

echo =====================================================================
echo    LIMRA RESTAURANT POS -- LOCAL THERMAL PRINTER BRIDGE
echo =====================================================================
echo  Target Printer: TVS Electronics RP 3200 Plus [RP3200 plus(U) 1]
echo  Paper Width:    80mm Thermal Roll (72mm / 272px vector printable)
echo  Local Bridge:   http://127.0.0.1:3000
echo  WebSocket:      ws://127.0.0.1:3000
echo  Web POS URL:    https://www.limraresturent.in/
echo =====================================================================
echo.

cd /d "%~dp0\.."

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    color 0C
    echo [ERROR] Node.js is not installed or not found in system PATH.
    echo Please install Node.js (v18+) from https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Starting background printer bridge on port 3000...
echo [INFO] Keep this window open or use start-printer-bridge-hidden.vbs
echo.

set PORT=3000
node backend/server.js

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [WARNING] Printer bridge server stopped. Press any key to restart...
    pause
    goto start
)
