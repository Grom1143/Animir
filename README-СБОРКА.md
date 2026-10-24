# Сборка Animax.exe

Требуется Python 3.10+ (проверено на 3.14) и пакеты:

```bat
python -m pip install -r requirements-build.txt
```

Затем:

```bat
build.bat
```

или

```bat
python build.py
```

Готовый файл: `..\Сборка Animax\Animax.exe` (один файл, без установки).
Промежуточные файлы PyInstaller — в `%TEMP%\Animax-build`.

## Установщик

Нужен [Inno Setup 6](https://jrsoftware.org/isinfo.php):

```bat
winget install JRSoftware.InnoSetup
build_installer.bat
```

`build_installer.py` сам скопирует свежий exe из `..\Сборка Animax` и соберёт
`dist\Animax-1.0.0-win64-setup.exe`. Установщик ставит приложение в профиль
пользователя (`%LOCALAPPDATA%\Programs\Animax`), без прав администратора;
создаёт ярлык в меню «Пуск», при желании — на рабочем столе; добавляет
запись в «Параметры → Приложения» и unins000.exe.

Скрипт установщика — `installer.iss`; версия, publisher и ссылка на репозиторий
задаются в начале файла.

## Что попадает в exe

- `Animax.pyw` — точка входа;
- `web/` — интерфейс (HTML/CSS/JS, hls.js);
- `animax.ico` — значок окна и трея;
- `notify_toast.ps1` — уведомления Windows;
- `sources.py` — онлайн-озвучки (Anixart, AniLiberty, Kodik);
- `Pillow` — увеличение/уменьшение обложек (если установлен при сборке);
- выбор папки в медиатеку — системный диалог через PowerShell (tkinter в exe не входит).

Сборка рассчитана на Windows 10/11 x64. Для работы нужен Microsoft Edge
(в Windows 10/11 он предустановлен); если Edge не найден, Animax откроется
в браузере по умолчанию.

## Подпись и SmartScreen

Exe не подписан, поэтому Windows может показать «Windows защитила ваш компьютер»
(SmartScreen). Чтобы убрать это предупреждение, нужен сертификат подписи кода
(EV/OV Code Signing) и подпись, например:

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a Animax.exe
```

Без сертификата пользователю нужно нажать «Подробнее» → «Выполнить в любом случае».
