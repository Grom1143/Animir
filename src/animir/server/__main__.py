"""Запуск только сервера: python -m animir.server [порт].

Нужен проверкам интерфейса и ручной отладке: окно к нему подключается обычным браузером.
"""
import sys

from .http import make_server


def main() -> int:
    port = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 8790
    srv = make_server(port)
    print(f"Анимир: сервер на http://127.0.0.1:{port}")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
