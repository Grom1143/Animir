"""Анимир - таблица маршрутов сервера: путь → обработчик.

Обработчик - метод класса Handler (server.py), помеченный @get("/путь") или @post("/путь").
GET-обработчик получает (self, q) - разобранные параметры адреса; POST-обработчик - (self) и сам читает тело.
Раньше маршруты были цепочками «if route == …» в нескольких местах; теперь один путь - одна строка в таблице,
а занять один путь дважды нельзя (ошибка видна сразу при запуске).
"""
from typing import Callable

GET: dict[str, Callable] = {}
POST: dict[str, Callable] = {}

# Под этими началами пути неизвестный адрес - 404. Остальные неизвестные GET отдают интерфейс (index.html):
# это адреса экранов, а опечатка в API под этими группами должна быть видна сразу.
API_GROUPS = ("/api/auth/", "/oauth/", "/api/shiki/", "/api/colls", "/api/online/", "/api/dubs/")


def _register(table: dict, paths: tuple[str, ...]):
    def deco(fn):
        for p in paths:
            if p in table:
                raise ValueError(f"маршрут {p} уже занят: {table[p].__qualname__}")
            table[p] = fn
        return fn
    return deco


def get(*paths: str):
    return _register(GET, paths)


def post(*paths: str):
    return _register(POST, paths)
