"""Animax — файл состояния state.json: чтение, запись и слияние изменений из разных окон.

Каждое окно (главное и окна плеера) держит свою копию состояния. Раньше побеждало то окно,
которое сохранилось последним, и, например, главное окно затирало прогресс, только что
записанный плеером. Теперь у состояния есть номер версии, а сервер помнит, от какой версии
отталкивалось каждое окно, и сливает изменения трёхсторонне (как git merge): берётся то,
что поменяло окно, плюс то, что за это время поменяли другие.
"""
import collections
import json
import threading

from config import STATE_FILE
from sysinfo import low_end

_state_lock = threading.Lock()


def load_state() -> dict:
    try:
        return json.loads(STATE_FILE.read_text("utf-8"))
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=1), "utf-8")
    tmp.replace(STATE_FILE)


_SUB_KEYS = ("subs", "subsDub")


def merge_subs(state: dict) -> None:
    """Объединяем подписки (🔔 тайтл и 🔔 озвучка) с уже сохранёнными.

    Нужно, когда сервер не знает, от какой версии отталкивалось окно (например, после
    перезапуска сервера): тогда новые подписки из файла не должны потеряться. Отписка пишет в
    subsDel метку времени (tombstone) и побеждает, только если она новее подписки."""
    try:
        cur = json.loads(STATE_FILE.read_text("utf-8")) if STATE_FILE.is_file() else {}
    except Exception:
        cur = {}
    inc_dels = state.get("subsDel") if isinstance(state.get("subsDel"), dict) else {}
    old_dels = cur.get("subsDel") if isinstance(cur.get("subsDel"), dict) else {}
    for k in _SUB_KEYS:
        inc = state.get(k)
        if not isinstance(inc, dict):
            inc = state[k] = {}
        for sk, sub in (cur.get(k) or {}).items():
            if sk in inc:
                continue  # окно уже знает эту подписку (или её изменение)
            try:
                ts = float((old_dels.get(f"{k}:{sk}") or inc_dels.get(f"{k}:{sk}") or 0))
            except (TypeError, ValueError):
                ts = 0
            try:
                sub_at = float(sub.get("at") or 0)
            except (TypeError, ValueError, AttributeError):
                sub_at = 0
            if ts and sub_at and ts > sub_at + 1:
                continue  # удалена ПОСЛЕ подписки — убираем
            inc[sk] = sub
    merged_dels = {}
    merged_dels.update(old_dels)
    merged_dels.update(inc_dels)
    state["subsDel"] = merged_dels


# ---------- трёхстороннее слияние ----------
_MISSING = object()


def _key(x) -> str:
    return json.dumps(x, sort_keys=True, ensure_ascii=False)


def _merge_list(base: list, mine: list, theirs: list) -> list:
    """Списки (история, уведомления, журнал серий): мои добавления и удаления поверх чужого списка."""
    bk = {_key(x) for x in base}
    mk = [_key(x) for x in mine]
    removed = bk - set(mk)
    rest = [x for x in theirs if _key(x) not in removed]
    restk = {_key(x) for x in rest}
    added = [x for x, k in zip(mine, mk) if k not in bk and k not in restk]
    if not added:
        return rest
    # Одна и та же запись (тот же id / файл), изменённая у меня, — моя версия главнее
    ident = next((f for f in ("id", "file") if all(isinstance(x, dict) and f in x for x in added)), None)
    if ident:
        ids = {_key(x[ident]) for x in added}
        rest = [x for x in rest if not (isinstance(x, dict) and ident in x and _key(x[ident]) in ids)]
    # новые записи окно добавляло в начало (история) или в конец (журнал) — сохраняем это
    prepend = bool(mk) and mk[0] not in bk
    return added + rest if prepend else rest + added


def merge3(base, mine, theirs, depth: int = 0):
    """mine — что прислало окно, theirs — что сейчас в файле, base — от чего окно отталкивалось."""
    if mine == base:
        return theirs
    if theirs == base or theirs == mine:
        return mine
    if isinstance(mine, dict) and isinstance(theirs, dict) and depth <= 2:
        b = base if isinstance(base, dict) else {}
        out = {}
        for k in dict.fromkeys([*theirs, *mine]):
            bv, mv, tv = b.get(k, _MISSING), mine.get(k, _MISSING), theirs.get(k, _MISSING)
            if mv is _MISSING:  # у меня ключа нет: удалил сам — убираем, иначе это чужое новое
                if bv is _MISSING or tv != bv:
                    out[k] = tv
                continue
            if tv is _MISSING:  # в файле ключа нет: удалили другие — убираем, если я его не менял
                if bv is _MISSING or mv != bv:
                    out[k] = mv
                continue
            out[k] = merge3(None if bv is _MISSING else bv, mv, tv, depth + 1)
        return out
    if isinstance(mine, list) and isinstance(theirs, list) and depth == 1:
        return _merge_list(base if isinstance(base, list) else [], mine, theirs)
    return mine  # одно и то же значение поменяли оба — побеждает тот, кто сохраняет сейчас


# Снимки версий, от которых отталкиваются окна: «r5» — версия 5 файла, «m5» — то, что
# прислало окно при сохранении версии 5 (если окно не взяло себе слитый результат).
_snaps: dict[str, dict] = {}
_win_keys: collections.OrderedDict[str, list[str]] = collections.OrderedDict()
MAX_WINDOWS = 16


def _strip(d: dict) -> dict:
    return {k: v for k, v in d.items() if not k.startswith("_")}


def _remember(win: str, keys: list[str]) -> None:
    _win_keys.pop(win, None)
    _win_keys[win] = keys
    while len(_win_keys) > MAX_WINDOWS:
        _win_keys.popitem(last=False)
    alive = {k for ks in _win_keys.values() for k in ks}
    for k in [k for k in _snaps if k not in alive]:
        del _snaps[k]


def read_for(win: str) -> dict:
    """Состояние для окна + метка версии (_rev), от которой окно будет отталкиваться."""
    with _state_lock:
        cur = load_state()
        clean = _strip(cur)
        key = f"r{int(cur.get('_rev') or 0)}"
        _snaps[key] = clean
        _remember(win or "anon", [key])
        return {**clean, "_rev": key}


def write_from(incoming: dict) -> dict:
    """Сохранить присланное окном состояние, слив его с изменениями других окон."""
    win = str(incoming.get("_win") or "anon")[:40]
    base_key = incoming.get("_base")
    mine = _strip(incoming)
    with _state_lock:
        cur = load_state()
        rev = int(cur.get("_rev") or 0)
        if base_key == f"r{rev}" or incoming.get("_replace") is True:  # _replace — загрузка резервной копии
            merged, did = mine, False
        else:
            base = _snaps.get(base_key) if isinstance(base_key, str) else None
            merged, did = merge3(base if base is not None else {}, mine, _strip(cur)), True
            if base is None:
                merge_subs(merged)  # версия окна неизвестна — хотя бы подписки не теряем
        rev += 1
        save_state({**merged, "_rev": rev})
        keys = [f"r{rev}"]
        _snaps[keys[0]] = merged
        if did:
            keys.append(f"m{rev}")
            _snaps[keys[1]] = mine
        _remember(win, keys)
    return {"ok": True, "rev": keys[0], "mine": keys[1] if did else None, "state": merged if did else None}


def lite_mode() -> bool:
    """Лёгкий режим для слабых компьютеров: настройка «Лёгкий режим» (auto / on / off), по умолчанию — сам по железу."""
    mode = (load_state().get("settings") or {}).get("lite", "auto")
    return mode == "on" or (mode == "auto" and low_end())
