using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("Animax")]
[assembly: AssemblyDescription("Animax launcher")]
[assembly: AssemblyProduct("Animax")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class Program
{
    [STAThread]
    static void Main()
    {
        string dir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        string app = Path.Combine(dir, "Animax.pyw");

        // 1) обычный запуск из исходников: pythonw.exe + Animax.pyw
        if (File.Exists(app))
        {
            string py = FindPython();
            if (py != null)
            {
                try
                {
                    var psi = new ProcessStartInfo(py, "\"" + app + "\"");
                    psi.WorkingDirectory = dir;
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    Process.Start(psi);
                    return;
                }
                catch { /* пробуем портативную сборку */ }
            }
        }

        // 2) портативная сборка рядом с лаунчером
        string[] candidates =
        {
            Path.Combine(dir, "Animax-portable", "Animax", "Animax.exe"),
            Path.Combine(dir, "Animax", "Animax.exe"),
            Path.Combine(dir, "portable", "Animax", "Animax.exe"),
            Path.Combine(dir, "..", "Animax-portable", "Animax", "Animax.exe")
        };
        foreach (string c in candidates)
        {
            try
            {
                string full = Path.GetFullPath(c);
                if (!File.Exists(full)) continue;
                if (string.Equals(full, Assembly.GetExecutingAssembly().Location, StringComparison.OrdinalIgnoreCase)) continue;
                Process.Start(new ProcessStartInfo(full)
                {
                    WorkingDirectory = Path.GetDirectoryName(full),
                    UseShellExecute = true
                });
                return;
            }
            catch { }
        }

        MessageBox.Show(
            "Не найден Python или папка с приложением Animax.\n\n" +
            "Установи Python с python.org (галочка «Add python.exe to PATH») " +
            "или положи рядом папку Animax-portable.",
            "Animax", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    static string FindPython()
    {
        // PATH
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string part in path.Split(';'))
        {
            try
            {
                string p = Path.Combine(part.Trim(), "pythonw.exe");
                if (File.Exists(p)) return p;
            }
            catch { }
        }

        // типовые места установки
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string[] versions = { "Python314", "Python313", "Python312", "Python311", "Python310", "Python39" };
        foreach (string v in versions)
        {
            string a = Path.Combine(local, "Programs", "Python", v, "pythonw.exe");
            if (File.Exists(a)) return a;
            string b = Path.Combine(pf, v, "pythonw.exe");
            if (File.Exists(b)) return b;
        }
        return null;
    }
}
