@echo off
title LIMRA POS — Test Thermal Printer Bridge
color 0E

echo =====================================================================
echo    LIMRA POS -- THERMAL PRINTER BRIDGE DIAGNOSTIC TEST
echo =====================================================================
echo.

echo [1/3] Checking if Printer Bridge is running on localhost:3000...
powershell -NoProfile -Command "try { $res = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/print-silent' -Method GET -TimeoutSec 3; Write-Host ' [OK] Bridge Responded!' -ForegroundColor Green; Write-Host '      Default Printer:' $res.resolvedPrinter; Write-Host '      Installed Count:' $res.printers.Count; } catch { Write-Host ' [FAIL] Bridge not responding on port 3000. Please run start-printer-bridge.bat' -ForegroundColor Red; exit 1; }"

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Please start the bridge before testing.
    pause
    exit /b 1
)

echo.
echo [2/3] Checking for TVS RP 3200 Plus printer in Windows spooler...
powershell -NoProfile -Command "$p = Get-Printer | Where-Object { $_.Name -like '*RP3200*' -or $_.Name -like '*TVS*' }; if ($p) { Write-Host ' [OK] Found Hardware Printer:' $p.Name -ForegroundColor Green; Write-Host '      Status:' $p.PrinterStatus ' Port:' $p.PortName; } else { Write-Host ' [WARNING] No TVS RP 3200 Plus printer detected in Windows. Ensure USB is plugged in.' -ForegroundColor Yellow; }"

echo.
echo [3/3] Sending test thermal receipt to printer...
powershell -NoProfile -Command "$body = @{ html = '<div style=\"font-family:Courier New,monospace;width:272px;font-size:12px;padding:4px;text-align:center;\"><h3 style=\"margin:0;\">LIMRA RESTAURANT POS</h3><p style=\"margin:2px 0;\">Bridge Diagnostic Test</p><hr style=\"border-top:1px dashed #000;margin:4px 0;\"/><div style=\"text-align:left;\"><span>Status:</span> <b>HARDWARE CONNECTED</b><br/><span>Time:</span> ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '<br/><span>Printer:</span> TVS RP 3200 Plus</div><hr style=\"border-top:1px dashed #000;margin:4px 0;\"/><p style=\"margin:0;\">READY FOR PRODUCTION BILLING</p><br/><br/></div>'; printerName = 'RP3200 plus(U) 1'; paperWidth = 80 } | ConvertTo-Json; try { $res = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/print-silent' -Method POST -ContentType 'application/json' -Body $body -TimeoutSec 5; if ($res.success) { Write-Host ' [OK] Test print sent successfully! Hardware confirmed: ' $res.hardware_confirmed -ForegroundColor Green; } else { Write-Host ' [ERROR] Print returned error: ' $res.error -ForegroundColor Red; } } catch { Write-Host ' [ERROR] Failed to send print job: ' $_.Exception.Message -ForegroundColor Red; }"

echo.
echo =====================================================================
echo Diagnostic test completed.
echo =====================================================================
pause
