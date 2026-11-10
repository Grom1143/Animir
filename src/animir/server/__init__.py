"""HTTP-сервер Анимира: сборка маршрутов и запуск на 127.0.0.1."""

from .app_routes import set_pending_nav
from .http import AppServer, Handler, make_server

__all__ = ["AppServer", "Handler", "make_server", "set_pending_nav"]
