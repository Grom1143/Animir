param(
  [Parameter(Mandatory = $true)][string]$lnk,
  [string]$target = "",
  [string]$arguments = "",
  [string]$icon = "",
  [string]$appid = "Animir",
  [string]$desc = "",

  [Parameter(Mandatory = $false)][switch]$ReadOnlyCheck
)
# Ярлык со своим AppUserModelID: по ярлыку Windows берёт значок и название для панели задач,
# уведомлений и закрепления. Без него задача с AUMID "Animir" показывается пустым листом.
# Иконка ставится обычным WScript.Shell, а AppUserModelID - через IPropertyStore (иначе никак).
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class LnkAumid {
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct PropertyKey { public Guid fmtid; public uint pid; }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(2)] public ushort r1;
        [FieldOffset(4)] public ushort r2;
        [FieldOffset(6)] public ushort r3;
        [FieldOffset(8)] public IntPtr p;
        [FieldOffset(16)] public IntPtr p2;
    }

    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        [PreserveSig] int GetCount(out uint count);
        [PreserveSig] int GetAt(uint index, out PropertyKey key);
        [PreserveSig] int GetValue(ref PropertyKey key, out PropVariant value);
        [PreserveSig] int SetValue(ref PropertyKey key, ref PropVariant value);
        [PreserveSig] int Commit();
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHGetPropertyStoreFromParsingName(string path, IntPtr bag, int flags,
        ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore store);

    static PropertyKey AppIdKey() {
        return new PropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
    }

    public static void SetAppId(string lnkPath, string appId) {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, 2, ref iid, out store);
        var key = AppIdKey();
        var pv = new PropVariant { vt = 31, p = Marshal.StringToCoTaskMemUni(appId) };
        try {
            int hr = store.SetValue(ref key, ref pv);
            if (hr != 0) throw new COMException("SetValue", hr);
            hr = store.Commit();
            if (hr != 0) throw new COMException("Commit", hr);
        } finally {
            Marshal.FreeCoTaskMem(pv.p);
            Marshal.ReleaseComObject(store);
        }
    }

    public static string GetAppId(string lnkPath) {
        Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
        IPropertyStore store;
        SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, 0, ref iid, out store);
        var key = AppIdKey();
        PropVariant pv;
        int hr = store.GetValue(ref key, out pv);
        string result = (hr == 0 && pv.vt == 31) ? Marshal.PtrToStringUni(pv.p) : "";
        Marshal.ReleaseComObject(store);
        return result;
    }
}
'@

try {
  if ($ReadOnlyCheck) {
    if (-not (Test-Path -LiteralPath $lnk)) { exit 1 }
    if ([LnkAumid]::GetAppId($lnk) -ne $appid) { exit 1 }
    exit 0
  }
  $dir = Split-Path -Parent $lnk
  if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
  $ws = New-Object -ComObject WScript.Shell
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $target
  if ($arguments) { $s.Arguments = $arguments }
  if ($icon) { $s.IconLocation = "$icon,0" }
  if ($desc) { $s.Description = $desc }
  $s.Save()
  [LnkAumid]::SetAppId($lnk, $appid)
  if ([LnkAumid]::GetAppId($lnk) -ne $appid) { [Console]::Error.WriteLine("aumid not set"); exit 1 }
  exit 0
} catch {
  [Console]::Error.WriteLine("shortcut error: $($_.Exception.Message)")
  exit 1
}
