@echo off
chcp 65001 >nul
rem Builds the small Animax.exe launcher (C#, .NET Framework, no PyInstaller).
cd /d "%~dp0"
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo csc.exe not found. Install .NET Framework 4.x.
  pause
  exit /b 1
)
"%CSC%" /nologo /target:winexe /codepage:65001 /r:System.Windows.Forms.dll /win32icon:..\animax.ico /out:..\Animax.exe launcher\AnimaxLauncher.cs
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo OK: %~dp0..\Animax.exe
pause
