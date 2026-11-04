# Сборка Animir.exe

Всё для сборки лежит в этой папке `packaging/`. Команды ниже запускаются из корня исходников.

Требуется Python 3.10+ (проверено на 3.14) и пакеты:

```bat
python -m pip install -r packaging\requirements-build.txt
```

Затем:

```bat
packaging\build.bat
```

или

```bat
python packaging\build.py
```

Готовый файл: `..\Сборка Animir\Animir.exe` (один файл, без установки).
Промежуточные файлы PyInstaller — в `%TEMP%\Animir-build`.

## Установщик

Нужен [Inno Setup 6](https://jrsoftware.org/isinfo.php):

```bat
winget install JRSoftware.InnoSetup
packaging\build_installer.bat
```

`build_installer.py` сам скопирует свежий exe из `..\Сборка Animir` и соберёт
`dist\Анимир-1.0.0-win64-setup.exe`. Установщик ставит приложение в профиль
пользователя (`%LOCALAPPDATA%\Programs\Animir`), без прав администратора;
создаёт ярлык в меню «Пуск», при желании — на рабочем столе; добавляет
запись в «Параметры → Приложения» и unins000.exe.

Скрипт установщика — `packaging/installer.iss`; версия, publisher и ссылка на репозиторий
задаются в начале файла.

## Что попадает в exe

- `Animir.pyw` — точка входа;
- `web/` — интерфейс (HTML/CSS/JS, hls.js);
- `animir.ico` — значок окна и трея;
- `notify_toast.ps1` — уведомления Windows;
- `sources.py` — онлайн-озвучки (Anixart, AniLiberty, Kodik);
- `Pillow` — увеличение/уменьшение обложек (если установлен при сборке);
- выбор папки в медиатеку — системный диалог через PowerShell (tkinter в exe не входит).

Сборка рассчитана на Windows 10/11 x64. Для работы нужен Microsoft Edge
(в Windows 10/11 он предустановлен); если Edge не найден, Анимир откроется
в браузере по умолчанию.

## Подпись и SmartScreen

Exe не подписан, поэтому Windows может показать «Windows защитила ваш компьютер»
(SmartScreen). Чтобы убрать это предупреждение, нужен сертификат подписи кода
(EV/OV Code Signing) и подпись, например:

```powershell
signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a Animir.exe
```

Без сертификата пользователю нужно нажать «Подробнее» → «Выполнить в любом случае».

## Другие варианты

- `build_portable.bat` — портативная сборка папкой (onedir), реже ловит ложные срабатывания антивирусов: `..\Animir-portable\Анимир\Animir.exe`.
- `build_launcher.bat` — маленький лаунчер `Animir.exe` на C# (`launcher/`), запускает `Animir.pyw` из исходников.
- `README.txt` — инструкция, которую установщик кладёт рядом с программой.
