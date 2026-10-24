"""Animax — коллекции Shikimori (чужие и свои).

В API Shikimori коллекций нет, поэтому читаем открытые страницы:
  /api/topics?forum=collections — список всех опубликованных коллекций (JSON, по 30, новые сначала);
  /collections.json?search=...  — поиск Shikimori (только по названию);
  /collections/<id>             — сама коллекция: описание, группы, тайтлы и подписи к ним;
  /<ник>/collections            — коллекции пользователя.
Поиск по описанию Shikimori не умеет, поэтому сервер Animax потихоньку обходит коллекции
и складывает описания в локальный индекс (см. Index) — по нему и ищем.
"""

import html
import json
import re
import threading
import time

KINDS = ("anime", "manga", "ranobe", "character", "person")

_entry = re.compile(r'<article class="c-column b-catalog_entry c-(\w+) entry-(\d+)[^"]*".*?</article>', re.S)
_preview = re.compile(r'<article class="[^"]*b-collection-topic.*?(?=<article class="[^"]*b-collection-topic|\Z)', re.S)
_tags = re.compile(r"<[^>]+>")


def _find(rx: str, s: str, default: str = "") -> str:
    m = re.search(rx, s, re.S)
    return html.unescape(m.group(1)) if m else default


def _int(rx: str, s: str) -> int:
    v = _find(rx, s, "0")
    return int(v) if v.isdigit() else 0


def text(h: str) -> str:
    """HTML → простой текст: абзацы и <br> становятся переносами строк."""
    h = re.sub(r"<br\s*/?>|</p>|</div>", "\n", h or "")
    t = html.unescape(_tags.sub("", h))
    return re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", t)).strip()


def entries(h: str) -> list:
    out = []
    for m in _entry.finditer(h):
        kind, eid, a = m.group(1), int(m.group(2)), m.group(0)
        if kind not in KINDS:
            continue
        out.append({
            "id": eid, "kind": kind,
            "name": _find(r"<span class='name-ru'>(.*?)</span>", a) or _find(r"<span class='name-en'>(.*?)</span>", a)
            or _find(r'<img alt="([^"]*)"', a),
            "poster": _find(r'<img[^>]*\bsrc="([^"]+)"', a),
        })
    return out


def _head(a: str) -> dict:
    """Общая часть карточки коллекции: название, автор, голоса, размер, даты."""
    return {
        "id": _int(r'/collections/(\d+)', a),
        "title": _find(r'<a class="name"[^>]*title="([^"]*)"', a) or _find(r'itemprop="headline" content="([^"]*)"', a)
        or _find(r'<meta content="([^"]*)" itemprop="headline"', a),
        "user": {"nickname": _find(r'data-user_nickname="([^"]*)"', a),
                 "avatar": _find(r'<span class="linkeable poster"[^>]*>\s*<img[^>]*src="([^"]+)"', a)},
        "up": _int(r'class="votes-for">(\d+)<', a),
        "down": _int(r'class="votes-against">(\d+)<', a),
        "size": _int(r'class="collection-size">(\d+)<', a),
        "comments": _int(r'<span class="comments">(\d+)<', a),
        "created": _find(r'class="section created_at".*?datetime="([^"]+)"', a),
        "changed": _find(r'class="section changed_at".*?datetime="([^"]+)"', a),
        "spoilers": "is-spoilers" in a[:3000] or 'class="b-anime_status_tag spoilers"' in a,
    }


def parse_previews(h: str) -> list:
    """Карточки коллекций из выдачи поиска или из профиля пользователя."""
    out = []
    for a in _preview.findall(h):
        item = _head(a)
        if item["id"]:
            item["preview"] = entries(a)[:8]
            out.append(item)
    return out


def from_topic(t: dict) -> dict:
    """Карточка коллекции из /api/topics?forum=collections."""
    user = t.get("user") or {}
    return {
        "id": int(t.get("linked_id") or 0), "title": t.get("topic_title") or "",
        "user": {"nickname": user.get("nickname", ""), "avatar": user.get("avatar", "")},
        "up": 0, "down": 0, "size": 0, "comments": int(t.get("comments_count") or 0),
        "created": t.get("created_at") or "", "changed": "", "spoilers": False,
        "preview": entries(t.get("html_body") or "")[:8],
    }


def parse_detail(h: str) -> dict:
    """Страница коллекции: шапка, описание, группы с тайтлами и подписями."""
    start = h.find("b-collection-topic")
    body = h[start:] if start >= 0 else h
    item = _head(body)
    item["title"] = text(_find(r"<h1[^>]*>(.*?)</h1>", h)) or _find(r'<meta content="([^"]*)" property="og:title"', h) or item["title"]
    # подписи к тайтлам лежат JSON-ом в data-texts
    notes = {}
    raw = _find(r'class="collection-groups[^"]*"[^>]*data-texts="([^"]*)"', body)
    try:
        for n in json.loads(raw or "[]"):
            notes[(str(n.get("linked_type", "")).lower(), int(n.get("linked_id") or 0))] = text(n.get("text", ""))
    except ValueError:
        pass
    a = body.find('itemprop="articleBody"')
    g = body.find('class="collection-groups', a)
    g = body.rfind("<div", a, g)  # сам тег <div class="collection-groups"> в описание не берём
    item["desc"] = text(body[body.find(">", a) + 1:g]) if a >= 0 and g > a else ""
    groups = []
    marks = list(re.finditer(r'(?:<div class="subheadline[^"]*">(.*?)</div>\s*)?<div class="cc-collection-groups" data-index="\d+">', body, re.S))
    for i, m in enumerate(marks):
        foot = body.find("<footer", m.end())  # после последней группы идёт голосование «полезна ли коллекция»
        end = marks[i + 1].start() if i + 1 < len(marks) else foot if foot > 0 else len(body)
        items = entries(body[m.end():end])
        for e in items:
            e["text"] = notes.get((e["kind"], e["id"]), "")
        groups.append({"name": text(m.group(1) or ""), "items": items})
    item["groups"] = groups
    item["size"] = item["size"] or sum(len(x["items"]) for x in groups)
    return item


def _norm(s: str) -> str:
    return (s or "").lower().replace("ё", "е")


class Index:
    """Локальный индекс коллекций для поиска по названию, описанию, группам и тайтлам.

    Обход идёт в фоне и медленно (≈1 коллекция в секунду поверх общей паузы к Shikimori),
    сохраняется в файл и продолжается после перезапуска; новые коллекции дочитываются раз в сутки.
    """

    def __init__(self, path, fetch_text):
        self.path = path
        self.fetch_text = fetch_text  # (url-путь) -> str
        self.lock = threading.Lock()
        self.data = {"order": [], "items": {}, "listed_at": 0}
        try:
            self.data.update(json.loads(path.read_text("utf-8")))
        except (OSError, ValueError):
            pass
        self.busy = False

    def save(self):
        with self.lock:
            raw = json.dumps(self.data, ensure_ascii=False)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(raw, "utf-8")
        tmp.replace(self.path)

    def status(self) -> dict:
        items = self.data["items"]
        return {"total": len(self.data["order"]), "done": sum(1 for x in items.values() if x.get("full")),
                "busy": self.busy, "listed": bool(self.data.get("listed_at"))}

    def put(self, item: dict, full: bool):
        """Записать коллекцию в индекс (full — со страницы коллекции, с описанием и тайтлами)."""
        cid = str(item["id"])
        with self.lock:
            old = self.data["items"].get(cid, {})
            if not full and old.get("full"):
                return
            rec = {k: item.get(k) for k in ("id", "title", "user", "up", "down", "size", "comments", "created", "changed", "spoilers")}
            rec["preview"] = item.get("preview") or old.get("preview") or []
            if full:
                rec["full"] = True
                rec["desc"] = item.get("desc", "")[:4000]
                rec["groups"] = [g["name"] for g in item.get("groups", []) if g["name"]]
                all_items = [e for g in item.get("groups", []) for e in g["items"]]
                rec["names"] = " · ".join(e["name"] for e in all_items)[:6000]
                rec["kinds"] = {k: sum(1 for e in all_items if e["kind"] == k) for k in KINDS if any(e["kind"] == k for e in all_items)}
                rec["anime"] = [e["id"] for e in all_items if e["kind"] == "anime"][:400]
                rec["preview"] = [e for e in all_items if e["kind"] == "anime"][:4] or all_items[:4]
            else:
                for k in ("desc", "groups", "names", "kinds", "anime", "full"):
                    if k in old:
                        rec[k] = old[k]
                rec["up"], rec["down"], rec["size"] = rec["up"] or old.get("up", 0), rec["down"] or old.get("down", 0), rec["size"] or old.get("size", 0)
            self.data["items"][cid] = rec
            if int(cid) not in self.data["order"]:
                self.data["order"].insert(0, int(cid))

    def crawl(self):
        """Запускается в отдельном потоке; busy ставит тот, кто запускает (чтобы не было двух обходов)."""
        try:
            if time.time() - self.data.get("listed_at", 0) > 24 * 3600:
                order, page = [], 1
                while True:
                    rows = json.loads(self.fetch_text(f"/api/topics?forum=collections&limit=30&page={page}") or "[]")
                    if not rows:
                        break
                    for t in rows:
                        it = from_topic(t)
                        if it["id"]:
                            order.append(it["id"])
                            self.put(it, False)
                    page += 1
                    time.sleep(0.5)
                with self.lock:
                    self.data["order"] = order
                    self.data["listed_at"] = time.time()
                self.save()
            todo = [i for i in self.data["order"] if not self.data["items"].get(str(i), {}).get("full")]
            for n, cid in enumerate(todo):
                try:
                    self.put(parse_detail(self.fetch_text(f"/collections/{cid}")), True)
                except Exception:  # noqa: BLE001 — одна битая коллекция не должна останавливать обход
                    pass
                if n % 20 == 19:
                    self.save()
                time.sleep(1.0)
            self.save()
        finally:
            self.busy = False

    def search(self, q: str, only_anime: bool, sort: str, page: int, per: int = 30) -> dict:
        words = [w for w in _norm(q).split() if w]
        with self.lock:
            recs = [self.data["items"][str(i)] for i in self.data["order"] if str(i) in self.data["items"]]
        out = []
        for r in recs:
            if only_anime and r.get("full") and not r.get("kinds", {}).get("anime"):
                continue
            if only_anime and not r.get("full") and r.get("preview") and not any(e["kind"] == "anime" for e in r["preview"]):
                continue
            score = 0
            if words:
                fields = ((_norm(r.get("title")), 6), (_norm(" ".join(r.get("groups", []))), 3),
                          (_norm(r.get("desc")), 2), (_norm(r.get("names")), 1), (_norm(r["user"]["nickname"]), 1))
                ok = True
                for w in words:
                    hit = sum(wt for f, wt in fields if w in f)
                    if not hit:
                        ok = False
                        break
                    score += hit
                if not ok:
                    continue
            out.append((score, r))
        keys = {
            "votes": lambda x: (x[1].get("up", 0) - x[1].get("down", 0), x[1].get("up", 0)),
            "size": lambda x: x[1].get("size", 0),
            "comments": lambda x: x[1].get("comments", 0),
        }
        if sort in keys:
            out.sort(key=keys[sort], reverse=True)
        elif words:
            out.sort(key=lambda x: x[0], reverse=True)  # по совпадению; при равенстве — новые выше (порядок order)
        items = [dict(r, match=_snippet(r, words)) for _, r in out[(page - 1) * per: page * per]]
        return {"items": items, "total": len(out), "done": page * per >= len(out)}


def _snippet(r: dict, words: list) -> str:
    """Кусочек описания вокруг найденного слова — чтобы было видно, почему коллекция попала в выдачу."""
    desc = r.get("desc") or ""
    if not words or not desc:
        return ""
    low = _norm(desc)
    for w in words:
        i = low.find(w)
        if i >= 0 and w not in _norm(r.get("title")):
            a = max(0, i - 60)
            return ("…" if a else "") + desc[a:i + len(w) + 80].replace("\n", " ") + "…"
    return ""
