@echo off
chcp 65001 >nul
rem Запуск Animax без чёрного окна консоли
cd /d "%~dp0"
where pythonw >nul 2>nul || (echo Не найден Python. Установи его с python.org ^(галочка "Add python.exe to PATH"^). & pause & exit /b)
start "" pythonw "%~dp0Animax.pyw"
