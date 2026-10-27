@echo off
chcp 65001 >nul
rem Безопасная портативная сборка Animax: папкой, без самораспаковки (onedir).
rem Результат: ..\..\Animax-portable\Animax\Animax.exe
cd /d "%~dp0"
python -m PyInstaller --noconfirm --clean Animax-onedir.spec --distpath "..\..\Animax-portable" --workpath "%TEMP%\Animax-onedir-build"
if errorlevel 1 (
  echo.
  echo Сборка не удалась. Установи PyInstaller: python -m pip install -r packaging\requirements-build.txt
  pause
  exit /b 1
)
echo.
echo Готово: %~dp0..\..\Animax-portable\Animax\Animax.exe
pause
