namespace TercihPusula.Desktop;

internal sealed class CommandLineOptions
{
    public bool SelfCheck { get; private init; }
    public bool EnableDevTools { get; private init; }
    public bool ShowHelp { get; private init; }
    public bool ShowVersion { get; private init; }
    public string? Dist { get; private init; }
    public string? ReportPath { get; private init; }

    public static CommandLineOptions Parse(string[] args)
    {
        return new CommandLineOptions
        {
            SelfCheck = args.Contains("--self-check"),
            EnableDevTools = args.Contains("--devtools"),
            ShowHelp = args.Contains("--help") || args.Contains("-h"),
            ShowVersion = args.Contains("--version"),
            Dist = ValueOf(args, "--dist"),
            ReportPath = ValueOf(args, "--report"),
        };
    }

    private static string? ValueOf(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length && !args[index + 1].StartsWith("--") ? args[index + 1] : null;
    }

    public static string Help =>
        """
        Tercih Pusulası — yerel Windows uygulaması

        Kullanım:
          TercihPusula.exe                       uygulamayı açar
          TercihPusula.exe --self-check          kabuk doğrulamasını koşar (çıkış 0/1)
          TercihPusula.exe --self-check --report <dosya>
                                                 raporu JSON olarak da yazar
          TercihPusula.exe --dist <klasör>       geliştirme: gömülü paket yerine klasör servis eder
          TercihPusula.exe --devtools            geliştirici araçlarını açar
          TercihPusula.exe --version | --help

        Veri yenileme (yeni ÖSYM dönemi): exe'nin yanına data-override klasörü
        (web build çıktısının tamamı) koyun; gömülü veri yerine o servis edilir.
        """;
}
