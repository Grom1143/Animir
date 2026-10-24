@echo off
chcp 65001 >nul
rem Creates an Animax shortcut on the Desktop.
rem Launch goes through pythonw.exe + Animax.pyw, without a packed EXE.
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

powershell -NoProfile -ExecutionPolicy Bypass -Command "$ws=New-Object -ComObject WScript.Shell; $p=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Animax.lnk'; $s=$ws.CreateShortcut($p); $s.TargetPath='%PY%'; $s.Arguments='\"%~dp0Animax.pyw\"'; $s.WorkingDirectory='%~dp0'; $s.IconLocation='%~dp0animax.ico'; $s.Description='Animax'; $s.Save(); Write-Host ('OK: ' + $p)"
echo.
echo Animax shortcut created on the Desktop.
pause
