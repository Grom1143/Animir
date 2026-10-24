# -*- mode: python ; coding: utf-8 -*-
"""Сборка Animax.exe (PyInstaller, один файл).

Запуск: build.bat или
  python -m PyInstaller --noconfirm --clean Animax.spec ^
      --distpath "..\\Сборка Animax" --workpath "%TEMP%\\Animax-build"
"""

a = Analysis(
    ['Animax.pyw'],
    pathex=[],
    binaries=[],
    datas=[
        ('web', 'web'),
        ('animax.ico', '.'),
        ('notify_toast.ps1', '.'),
    ],
    hiddenimports=[
        # импортируются внутри функций — PyInstaller их не всегда видит
        'PIL.Image',
        'PIL.ImageFilter',
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
    name='Animax',
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
    icon='animax.ico',
    version='version_info.txt',
)
