@echo off
title LIMRA POS — Install Windows Print Bridge Auto-Start Service
color 0B

echo =====================================================================
echo    LIMRA POS -- INSTALL WINDOWS PRINT BRIDGE AUTO-START
echo =====================================================================
echo This installer will configure the TVS RP 3200 Plus silent print bridge
echo to launch automatically in the background whenever Windows boots.
echo =====================================================================
echo.

set SCRIPT_DIR=%~dp0
set VBS_TARGET=%SCRIPT_DIR%start-printer-bridge-hidden.vbs
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_PATH=%STARTUP_FOLDER%\LIMRA_Printer_Bridge.lnk

echo [1/3] Verifying source launcher: %VBS_TARGET%
if not exist "%VBS_TARGET%" (
    color 0C
    echo [ERROR] Could not find %VBS_TARGET%
    pause
    exit /b 1
)

echo [2/3] Creating Windows Startup shortcut...
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%VBS_TARGET%\"'; $s.WorkingDirectory = '%SCRIPT_DIR%'; $s.Description = 'LIMRA POS Silent Thermal Printer Bridge'; $s.Save()"

if %ERRORLEVEL% EQU 0 (
    echo [OK] Shortcut created successfully at:
    echo      %SHORTCUT_PATH%
) else (
    color 0C
    echo [ERROR] Failed to create shortcut.
    pause
    exit /b 1
)

echo.
echo [3/3] Launching printer bridge now in background...
start "" wscript.exe "%VBS_TARGET%"

echo.
echo =====================================================================
echo [SUCCESS] LIMRA Thermal Printer Bridge installed!
echo - Auto-starts silently on Windows boot
echo - Accessible to https://www.limraresturent.in on ws://127.0.0.1:3000
echo - Hardware target: TVS RP 3200 Plus (RP3200 plus(U) 1)
echo =====================================================================
echo.
pause
