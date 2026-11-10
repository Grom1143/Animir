"""Анимир - сведения о компьютере: сколько памяти и ядер. По ним включается лёгкий режим."""
import ctypes
import os
from ctypes import wintypes
from functools import cache


class _MemStatus(ctypes.Structure):
    _fields_ = [("dwLength", wintypes.DWORD), ("dwMemoryLoad", wintypes.DWORD),
                ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]


@cache
def ram_gb() -> float:
    m = _MemStatus()
    m.dwLength = ctypes.sizeof(m)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m)):
        return 8.0
    return m.ullTotalPhys / 2**30


def cores() -> int:
    return os.cpu_count() or 1


def low_ram() -> bool:
    """Мало оперативной памяти - экономим её в первую очередь."""
    return ram_gb() <= 4.2


def low_cpu() -> bool:
    """Одно-два ядра - меньше параллельных процессов и фоновой работы."""
    return cores() <= 2


def low_end() -> bool:
    """Слабый компьютер: до 4 ГБ памяти или 1-2 ядра."""
    return low_ram() or low_cpu()


class _PowerStatus(ctypes.Structure):
    _fields_ = [("ACLineStatus", wintypes.BYTE), ("BatteryFlag", wintypes.BYTE),
                ("BatteryLifePercent", wintypes.BYTE), ("SystemStatusFlag", wintypes.BYTE),
                ("BatteryLifeTime", wintypes.DWORD), ("BatteryFullLifeTime", wintypes.DWORD)]


_BATTERY_NONE = 128  # BatteryFlag: батареи нет (стационарный ПК)


def _from_status(ac_line: int, battery_flag: int) -> bool:
    """Решение по данным Windows: от сети (ac_line=1) - нет; батареи нет совсем - тоже нет."""
    return ac_line == 0 and not battery_flag & _BATTERY_NONE


def on_battery() -> bool:
    """Ноутбук работает от батареи, а не от сети. На ПК без батареи - всегда False."""
    s = _PowerStatus()
    if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(s)):
        return False
    return _from_status(s.ACLineStatus, s.BatteryFlag)


def info() -> dict:
    return {"ram_gb": round(ram_gb(), 1), "cores": cores(), "low_end": low_end(),
            "low_ram": low_ram(), "low_cpu": low_cpu(), "on_battery": on_battery()}
