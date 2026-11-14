using System.Text;

namespace TercihPusula.Desktop;

/// <summary>
/// The app is a WinExe, so a console only exists when the process was started from one
/// (npm script, cmd, CI). Attach to the parent console before writing anything.
/// </summary>
internal static class ConsoleBridge
{
    private const int AttachParentProcess = -1;
    private static bool _ready;

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AttachConsole(int processId);

    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AllocConsole();

    public static void Attach(bool allocateIfMissing = false)
    {
        if (_ready) return;
        if (!AttachConsole(AttachParentProcess) && allocateIfMissing) AllocConsole();
        var utf8 = new UTF8Encoding(false);
        try
        {
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput(), utf8) { AutoFlush = true });
            Console.SetError(new StreamWriter(Console.OpenStandardError(), utf8) { AutoFlush = true });
        }
        catch (IOException)
        {
            // No usable handle (rare: fully detached process). Self-check output is lost,
            // the exit code still carries the verdict.
        }
        try
        {
            Console.OutputEncoding = utf8;
        }
        catch (IOException)
        {
            // Encoding can only be set on a real console; redirected pipes reject it.
        }
        _ready = true;
    }

    public static void Write(string text) => Console.Out.WriteLine(text);
}
