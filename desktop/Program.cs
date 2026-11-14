using System.Diagnostics;
using System.Reflection;

namespace TercihPusula.Desktop;

internal static class Program
{
    /// <summary>Milliseconds since the OS created this process (includes runtime startup).</summary>
    internal static long ElapsedMs => (long)(DateTime.Now - Process.GetCurrentProcess().StartTime).TotalMilliseconds;

    private static Mutex? _singleInstance;

    [STAThread]
    private static int Main(string[] args)
    {
        var options = CommandLineOptions.Parse(args);

        if (options.ShowHelp)
        {
            ConsoleBridge.Attach();
            ConsoleBridge.Write(CommandLineOptions.Help);
            return 0;
        }
        if (options.ShowVersion)
        {
            ConsoleBridge.Attach();
            ConsoleBridge.Write(Version());
            return 0;
        }
        if (options.SelfCheck)
        {
            ConsoleBridge.Attach(allocateIfMissing: true);
            try
            {
                var selfCheckBundle = DistBundle.Prepare(options.Dist);
                selfCheckBundle.DataRound = MainForm.ReadDataRound(selfCheckBundle.Folder);
                return SelfCheck.Run(selfCheckBundle, options);
            }
            catch (Exception error)
            {
                ConsoleBridge.Write($"self-check setup failed: {error.Message}");
                return 2;
            }
        }

        _singleInstance = new Mutex(true, @"Local\TercihPusula.Desktop", out var isFirst);
        if (!isFirst)
        {
            MessageBox.Show(
                "Tercih Pusulası zaten açık.",
                "Tercih Pusulası",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return 0;
        }

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        Bundle bundle;
        try
        {
            bundle = DistBundle.Prepare(options.Dist);
            bundle.DataRound = MainForm.ReadDataRound(bundle.Folder);
        }
        catch (Exception error)
        {
            MessageBox.Show(
                $"{error.Message}\n\nUygulamayı 'node scripts/desktop-build.mjs' ile yeniden paketleyin.",
                "Tercih Pusulası",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 2;
        }

        try
        {
            Application.Run(new MainForm(bundle, options));
            return 0;
        }
        finally
        {
            _singleInstance?.ReleaseMutex();
            _singleInstance?.Dispose();
        }
    }

    internal static string Version() =>
        Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";
}
