@echo off
chcp 65001 >nul
rem Безопасная портативная сборка Анимир: папкой, без самораспаковки (onedir).
rem Результат: ..\..\Animir-portable\Анимир\Animir.exe
cd /d "%~dp0"
python -m PyInstaller --noconfirm --clean Animir-onedir.spec --distpath "..\..\Animir-portable" --workpath "%TEMP%\Animir-onedir-build"
if errorlevel 1 (
  echo.
  echo Сборка не удалась. Установи PyInstaller: python -m pip install -r packaging\requirements-build.txt
  pause
  exit /b 1
)
echo.
echo Готово: %~dp0..\..\Animir-portable\Анимир\Animir.exe
pause
