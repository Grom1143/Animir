"""Animax — медиатека: свои папки с видео, субтитры, выбор папки, увеличение мелких картинок."""
import os
import re
import subprocess
import sys
from pathlib import Path

from config import FROZEN, SUB_EXT, VIDEO_EXT
from state import load_state

def enhanced(src: Path, want: int, upscale: bool = True) -> Path | None:
    """Картинка нужной ширины: крупную уменьшаем (меньше памяти в окне), мелкую увеличиваем — Lanczos + лёгкая резкость.

    Готовый результат лежит в кэше рядом с оригиналом (имя + «-w<ширина>»).
    Если картинка и так подходящего размера или Pillow не установлен — None, отдаём оригинал.
    """
    out = src.with_name(f"{src.name}-w{want}")
    if out.exists():
        return out
    try:
        from PIL import Image, ImageFilter
    except ImportError:
        return None
    try:
        with Image.open(src) as im:
            if im.width > want * 1.2:  # крупная — уменьшаем
                im = im.convert("RGB")
                im.thumbnail((want, round(im.height * want / im.width)), Image.LANCZOS)
                tmp = out.with_name(out.name + ".tmp")
                im.save(tmp, "JPEG", quality=86, optimize=True)
                tmp.replace(out)
                return out
            if im.width >= want * 0.95 or not upscale:
                return None
            k = min(want / im.width, 3)  # сильнее трёх раз растягивать бессмысленно
            im = im.convert("RGB")
            # сначала чуть сглаживаем «квадратики» сжатия, потом увеличиваем и возвращаем резкость
            im = im.filter(ImageFilter.SMOOTH) if im.width < 200 else im
            im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS)
            im = im.filter(ImageFilter.UnsharpMask(radius=1.4, percent=70, threshold=2))
            tmp = out.with_name(out.name + ".tmp")
            im.save(tmp, "JPEG", quality=92, optimize=True)
            tmp.replace(out)
        return out
    except OSError:
        return None



def library_folders() -> list[Path]:
    folders = load_state().get("library", {}).get("folders", [])
    return [Path(f).resolve() for f in folders if f]


def is_allowed_media(p: Path) -> bool:
    p = p.resolve()
    return any(p.is_relative_to(f) for f in library_folders())


def find_subtitle(video: Path) -> str | None:
    for ext in SUB_EXT:
        s = video.with_suffix(ext)
        if s.exists():
            return str(s)
    return None


def scan_library() -> list[dict]:
    items = []
    for root in library_folders():
        if not root.is_dir():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if not d.startswith(".")]
            for name in filenames:
                p = Path(dirpath) / name
                if p.suffix.lower() not in VIDEO_EXT:
                    continue
                try:
                    st = p.stat()
                except OSError:
                    continue
                items.append({
                    "path": str(p),
                    "name": p.stem,
                    "dir": str(p.parent),
                    "root": str(root),
                    "size": st.st_size,
                    "ext": p.suffix.lower(),
                    "sub": find_subtitle(p),
                })
    items.sort(key=lambda i: (i["dir"].lower(), natural_key(i["name"])))
    return items


def natural_key(s: str):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", s)]


def srt_to_vtt(text: str) -> str:
    text = text.replace("\r\n", "\n").lstrip("﻿")
    text = re.sub(r"(\d{2}:\d{2}:\d{2}),(\d{3})", r"\1.\2", text)
    return "WEBVTT\n\n" + text


def _pick_folder_ps() -> str:
    """Выбор папки в exe: системный диалог через PowerShell (tkinter в сборку не входит)."""
    out = Path(os.environ.get("TEMP", ".")) / f"animax-folder-{os.getpid()}-{os.urandom(3).hex()}.txt"
    script = r"""
Add-Type -AssemblyName System.Windows.Forms
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Папка с аниме'
$d.ShowNewFolderButton = $false
if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  [IO.File]::WriteAllText($env:ANIMAX_DIR_OUT, $d.SelectedPath, (New-Object Text.UTF8Encoding($false)))
}
"""
    env = dict(os.environ, ANIMAX_DIR_OUT=str(out))
    try:
        subprocess.run(
            ["powershell.exe", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
            env=env, capture_output=True, timeout=600,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return out.read_text("utf-8").strip() if out.is_file() else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""
    finally:
        out.unlink(missing_ok=True)


def pick_folder() -> str:
    if FROZEN:  # в exe нет отдельного python — системный диалог через PowerShell
        return _pick_folder_ps()
    code = (
        "import tkinter as t, tkinter.filedialog as f\n"
        "r=t.Tk(); r.withdraw(); r.attributes('-topmost', True)\n"
        "print(f.askdirectory(title='Папка с аниме', mustexist=True) or '', end='')\n"
    )
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    out = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True,
                         env=env, timeout=600,
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return out.stdout.decode("utf-8", "replace").strip()
