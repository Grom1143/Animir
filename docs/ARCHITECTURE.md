# Устройство Анимира

Коротко: одно окно на WebView2, локальный HTTP-сервер на Python и интерфейс на HTML/CSS/JS.
Интерфейс не знает о Windows: он ходит в `http://127.0.0.1:8790/api/...`, а сервер уже решает, кого спросить.

```text
Animir.pyw            запуск: добавляет src в sys.path и вызывает animir.app.startup.run()
src/animir/
  __init__.py         версия пакета
  __main__.py         python -m animir
  app/
    startup.py        один экземпляр, порт 8790, окно, трей, протокол animir:, ярлык
    window.py         окна на pywebview (WebView2): главное и плеер; запасной путь - Edge --app
    windows.py        Win32: значки окна, тёмный заголовок, «поверх всех», тосты
    tray.py           значок в трее
    notify_toast.ps1  тост-уведомление Windows (AppID, логотип, постер)
    ensure_shortcut.ps1  ярлык в «Пуск» с AppUserModelID (значок в панели задач)
  server/
    http.py           ThreadingHTTPServer, Handler, защита Host/Origin
    routes.py         таблица маршрутов (@get / @post), проверка дублей при старте
    app_routes.py     настройки, состояние, папки, `/api/notify`, `/api/quit`
    shiki_routes.py   прокси к Shikimori (GraphQL, REST, OAuth, коллекции, отзывы)
    online_routes.py  озвучки, ссылки на серии, проверка источников, скачивание
    files.py          `/img`, `/media`, `/sub`, статика интерфейса
  shikimori/
    net.py            пул keep-alive соединений, лимит запросов, загрузка картинок
    data.py           GraphQL и кэш (память + диск, отдаёт прошлый ответ без сети)
    auth.py           OAuth, user_rates, прогресс, отзывы
    colls.py          коллекции Shikimori
    reviews.py        разбор страницы отзывов
  sources/
    anixart.py        озвучки Anixart
    aniliberty.py     озвучки AniLiberty (HLS)
    kodik.py          озвучки Kodik, извлечение прямой ссылки, токены
    counts.py         популярность студий (скан топ-300) и порядок озвучек
    search.py         каталог озвучек
    health.py         проверка источников для экрана диагностики
  config.py           пути, адреса, белые списки, перенос данных из Animax/AnyX
  state.py            state.json, трёхстороннее слияние изменений из окон
  media.py            медиатека, SRT -> VTT, выбор папки, картинки
  downloads.py        очередь скачивания: mp4 и HLS-сегменты
  sysinfo.py          память, ядра, «на батарее»
  web/                интерфейс: index.html, css/, js/, иконки, hls.js
tests/                unittest + ui_smoke.py (Playwright)
packaging/            PyInstaller, Inno Setup, установщик
docs/                 документация и скриншоты
```

## Поток запроса

1. Окно открывает `http://127.0.0.1:<порт>/` (по умолчанию 8790, либо свободный порт в проверках).
2. `server/http.py` проверяет `Host` и `Origin` (к серверу нельзя обратиться с чужого сайта) и выбирает
   обработчик по таблице `server/routes.py`.
3. Обработчик ходит в Shikimori через `shikimori/net.py` (общий пул соединений и лимит запросов) или в источники
   озвучек через `sources/*`.
4. Картинки и видео идут через `/img`, `/media`, `/sub`: браузер не ходит на чужие домены напрямую.

## Окна и данные

- Главное окно создаёт `app/window.py`. Крестик прячет окно в трей, «Выход» гасит сервер.
- Окно плеера одно: новая серия переключает его, а не открывает второе.
- Настройки и списки живут в `%APPDATA%\Animir\state.json`; окна синхронизируются через `/api/state`
  и трёхстороннее слияние (`state.py`).

## Скачивание

`downloads.py` разрешает серию той же функцией, что и плеер (`sources.online_stream`), затем:
прямой mp4 качает потоком, HLS разбирает на сегменты и склеивает в `.ts`. Прогресс и отмена - в памяти процесса,
файлы - в «Загрузки\Анимир».

## Сборка

- `packaging/Animir.spec` - PyInstaller, один файл; точка входа `Animir.pyw`.
- `packaging/build.py` - сборка exe, `packaging/build_installer.py` - установщик Inno Setup.
- В бандл кладутся `src/animir/web`, иконка и два PowerShell-скрипта; `config.py` в собранном виде ищет их
  в `sys._MEIPASS`.

## Проверки

- `python -m unittest discover -s tests` - юнит-тесты без интернета (сервер, состояние, окна, источники).
- `python -X utf8 tests/ui_smoke.py` - обход экранов в Edge: ошибки JS, кнопки, плеер, «Мой год», темы.
