"""Слияние состояния из разных окон (state.merge3): окна не должны затирать изменения друг друга.

Запуск из папки проекта: python -m unittest discover -s tests -v
"""
import os
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

# config.py создаёт папку данных в %APPDATA% при импорте — подменяем её на временную.
# Не tempfile.mkdtemp: его права «только владелец» не пускают песочницу DeepSeek (см. test_server.py).
os.environ["APPDATA"] = os.path.join(tempfile.gettempdir(), f"animax-test-{uuid.uuid4().hex[:8]}")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import state  # noqa: E402
from state import merge3  # noqa: E402


class Merge3Test(unittest.TestCase):
    def test_untouched_window_does_not_overwrite_others(self):
        # главное окно ничего не меняло, плеер за это время записал прогресс — прогресс остаётся
        base = {"progress": {"a": {"t": 10}}, "settings": {"volume": 1}}
        mine = {"progress": {"a": {"t": 10}}, "settings": {"volume": 1}}
        theirs = {"progress": {"a": {"t": 300}}, "settings": {"volume": 1}}
        self.assertEqual(merge3(base, mine, theirs), theirs)

    def test_changes_of_both_windows_are_kept(self):
        base = {"list": {"1": {"status": "planned"}}, "progress": {}}
        mine = {"list": {"1": {"status": "watching"}}, "progress": {}}  # главное окно: статус
        theirs = {"list": {"1": {"status": "planned"}}, "progress": {"o:1:x:1": {"t": 50}}}  # плеер: прогресс
        out = merge3(base, mine, theirs)
        self.assertEqual(out["list"]["1"]["status"], "watching")
        self.assertEqual(out["progress"]["o:1:x:1"]["t"], 50)

    def test_fields_of_one_entry_merge_separately(self):
        base = {"list": {"1": {"status": "watching", "score": 0, "ep": 3}}}
        mine = {"list": {"1": {"status": "watching", "score": 4, "ep": 3}}}
        theirs = {"list": {"1": {"status": "watching", "score": 0, "ep": 4}}}
        self.assertEqual(merge3(base, mine, theirs)["list"]["1"], {"status": "watching", "score": 4, "ep": 4})

    def test_deletion_is_respected(self):
        base = {"notes": {"1": {"text": "a"}, "2": {"text": "b"}}}
        mine = {"notes": {"2": {"text": "b"}}}  # я удалил заметку 1
        theirs = {"notes": {"1": {"text": "a"}, "2": {"text": "b"}, "3": {"text": "c"}}}  # другое окно добавило 3
        self.assertEqual(merge3(base, mine, theirs), {"notes": {"2": {"text": "b"}, "3": {"text": "c"}}})

    def test_conflict_on_same_value_wins_who_saves(self):
        self.assertEqual(merge3({"settings": {"speed": 1}}, {"settings": {"speed": 2}}, {"settings": {"speed": 1.5}}),
                         {"settings": {"speed": 2}})

    def test_history_lists_union_newest_first(self):
        base = {"history": [{"file": "a", "at": 1}]}
        mine = {"history": [{"file": "b", "at": 3}, {"file": "a", "at": 1}]}
        theirs = {"history": [{"file": "c", "at": 2}, {"file": "a", "at": 1}]}
        files = [h["file"] for h in merge3(base, mine, theirs)["history"]]
        self.assertEqual(files, ["b", "c", "a"])

    def test_same_record_changed_in_list_keeps_my_version_once(self):
        base = {"history": [{"file": "a", "at": 1}]}
        mine = {"history": [{"file": "a", "at": 5}]}
        theirs = {"history": [{"file": "a", "at": 4}]}
        self.assertEqual(merge3(base, mine, theirs)["history"], [{"file": "a", "at": 5}])

    def test_append_only_log_keeps_order(self):
        base = {"watchLog": [1, 2]}
        mine = {"watchLog": [1, 2, 3]}
        theirs = {"watchLog": [1, 2, 4]}
        self.assertEqual(merge3(base, mine, theirs)["watchLog"], [1, 2, 4, 3])


class WriteFromTest(unittest.TestCase):
    def setUp(self):
        state.STATE_FILE.unlink(missing_ok=True)
        state._snaps.clear()
        state._win_keys.clear()

    def test_two_windows_do_not_lose_each_other(self):
        main = state.read_for("main")
        player = state.read_for("player")
        self.assertEqual(main["_rev"], player["_rev"])
        # плеер сохраняет прогресс
        r1 = state.write_from({"progress": {"x": {"t": 100}}, "_base": player["_rev"], "_win": "player"})
        self.assertIsNone(r1["state"])  # слияние не понадобилось
        # главное окно со старой копией сохраняет оценку — прогресс плеера не должен пропасть
        r2 = state.write_from({"progress": {}, "list": {"1": {"score": 5}}, "_base": main["_rev"], "_win": "main"})
        self.assertEqual(r2["state"]["progress"], {"x": {"t": 100}})
        self.assertEqual(r2["state"]["list"], {"1": {"score": 5}})
        saved = state.load_state()
        self.assertEqual(saved["progress"], {"x": {"t": 100}})
        self.assertEqual(saved["_rev"], 2)

    def test_window_that_kept_its_copy_merges_from_what_it_sent(self):
        a = state.read_for("a")
        b = state.read_for("b")
        state.write_from({"notes": {"1": "x"}, "_base": b["_rev"], "_win": "b"})
        r = state.write_from({"notes": {}, "marks": {"5": {"1": 1}}, "_base": a["_rev"], "_win": "a"})
        # окно «a» не взяло слитый результат (пока шёл ответ, оно поменяло ещё) — база для него теперь «mine»
        state.write_from({"notes": {}, "marks": {"5": {"1": 1, "2": 2}}, "_base": r["mine"], "_win": "a"})
        saved = state.load_state()
        self.assertEqual(saved["notes"], {"1": "x"})
        self.assertEqual(saved["marks"], {"5": {"1": 1, "2": 2}})

    def test_replace_overwrites(self):
        state.write_from({"list": {"1": {}}, "history": [1], "_win": "a"})
        state.write_from({"list": {"2": {}}, "_replace": True, "_win": "a"})
        saved = state.load_state()
        self.assertEqual(saved["list"], {"2": {}})
        self.assertNotIn("history", saved)


if __name__ == "__main__":
    unittest.main()
