@echo off
chcp 65001 >nul
rem Полностью закрывает Animax: окно и сервер. Потом «Запустить Animax.bat» поднимет всё заново.
curl -s -m 5 -X POST http://127.0.0.1:8790/api/quit >nul 2>nul
timeout /t 2 /nobreak >nul
rem если сервер не ответил — добиваем процессы Animax вручную
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'msedge.exe' -and $_.CommandLine -like '*Animax\window*') -or ($_.Name -like 'python*.exe' -and $_.CommandLine -like '*Animax.pyw*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
