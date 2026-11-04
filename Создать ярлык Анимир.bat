@echo off
chcp 65001 >nul
rem Creates an Animir shortcut on the Desktop.
rem Launch goes through pythonw.exe + Animir.pyw, without a packed EXE.
cd /d "%~dp0"

set "PY="
for /f "delims=" %%P in ('where pythonw.exe 2^>nul') do if not defined PY set "PY=%%P"
if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python312\pythonw.exe"
if not defined PY (
  echo.
  echo pythonw.exe not found. Install Python from python.org
  echo and enable "Add python.exe to PATH".
  echo.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $p=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Анимир.lnk'; $s=$ws.CreateShortcut($p); $s.TargetPath='%PY%'; $s.Arguments='\"%~dp0Animir.pyw\"'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0animir.ico'; $s.Description='Анимир'; $s.Save(); Write-Host ('OK: ' + $p)"
echo.
echo Animir shortcut created on the Desktop.
pause
