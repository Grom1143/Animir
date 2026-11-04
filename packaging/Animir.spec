# -*- mode: python ; coding: utf-8 -*-
"""Сборка Animir.exe (PyInstaller, один файл).

Запуск: packaging\\build.bat или
  python -m PyInstaller --noconfirm --clean packaging\\Animir.spec ^
      --distpath "..\\Сборка Animir" --workpath "%TEMP%\\Animir-build"
"""

import os

# спек лежит в packaging/, исходники — уровнем выше
ROOT = os.path.dirname(SPECPATH)

a = Analysis(
    [os.path.join(ROOT, 'Animir.pyw')],
    pathex=[ROOT],
    binaries=[],
    datas=[
        (os.path.join(ROOT, 'web'), 'web'),
        (os.path.join(ROOT, 'animir.ico'), '.'),
        (os.path.join(ROOT, 'notify_toast.ps1'), '.'),
    ],
    hiddenimports=[
        # импортируются внутри функций — PyInstaller их не всегда видит
        'PIL.Image',
        'PIL.ImageFilter',
        # pywebview выбирает движок окна на лету — модули Windows-окна (WinForms + WebView2) указываем явно
        'webview.platforms.winforms',
        'webview.platforms.edgechromium',
        'clr',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['pytest', 'setuptools', 'pip', 'numpy', 'psutil', 'yaml', 'tkinter', '_tkinter'],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='Animir',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,              # без чёрного окна консоли
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join(ROOT, 'animir.ico'),
    version=os.path.join(SPECPATH, 'version_info.txt'),
)
