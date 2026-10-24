"""Animax — отзывы других пользователей Shikimori.

В API Shikimori нет списка отзывов тайтла, поэтому читаем открытую страницу
shikimori.io/animes/<id>/reviews и вынимаем из неё: автора, мнение (положительный /
нейтральный / отрицательный), голоса «полезно», оценку автора и текст.
"""

import html
import re

OPINIONS = ("positive", "neutral", "negative")
PER_PAGE = 8  # столько отзывов Shikimori показывает на одной странице

_article = re.compile(r'<article class="[^"]*b-review-topic.*?</article>', re.S)
_counts = re.compile(r'navigation-node-(all|positive|neutral|negative)\b.*?<div class="count">(\d+)</div>', re.S)


def _find(rx: str, s: str, default: str = "") -> str:
    m = re.search(rx, s, re.S)
    return html.unescape(m.group(1)) if m else default


def _int(rx: str, s: str) -> int:
    v = _find(rx, s, "0")
    return int(v) if v.isdigit() else 0


def page_url(anime_id: int, opinion: str = "", page: int = 1) -> str:
    path = f"/animes/{int(anime_id)}/reviews"
    if opinion in OPINIONS:
        path += "/" + opinion
    if page > 1:
        path += f"/page/{int(page)}"
    return path


def parse(page_html: str) -> dict:
    counts = {k: int(v) for k, v in _counts.findall(page_html)}
    items = []
    for a in _article.findall(page_html):
        rid = _int(r'data-url="[^"]*/reviews/(\d+)"', a)
        if not rid:
            continue
        status = _find(r'class="b-add_to_list (\w+)"', a)
        items.append({
            "id": rid,
            "topic_id": _int(r'\bid="(\d+)"', a),
            "user": {
                "id": _int(r'data-user_id="(\d+)"', a),
                "nickname": _find(r'data-user_nickname="([^"]*)"', a),
                "avatar": _find(r'<a class="author-link"[^>]*>\s*<img src="([^"]+)"', a),
            },
            "opinion": _find(r'class="opinion (positive|neutral|negative)"', a, "neutral"),
            "up": _int(r'class="votes-for">(\d+)<', a),
            "down": _int(r'class="votes-against">(\d+)<', a),
            "comments": _int(r'<span class="comments">(\d+)<', a),
            "created_at": _find(r'<time[^>]*datetime="([^"]+)"', a),
            "score": _int(r'class="stars score score-(\d+)"', a),  # оценка автора 0–10
            "status": status if status in ("planned", "watching", "rewatching", "completed", "on_hold", "dropped") else "",
            # HTML отзыва; в интерфейсе он ещё раз чистится (commentBody) — оставляются только безопасные теги
            "html": (re.search(r'<div class="body" itemprop="text">(.*?)</div>\s*<footer>', a, re.S) or [None, ""])[1],
        })
    return {"counts": {k: counts.get(k, 0) for k in ("all", *OPINIONS)}, "items": items, "done": len(items) < PER_PAGE}
