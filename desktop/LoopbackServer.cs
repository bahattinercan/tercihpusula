using System.Net;
using System.Net.Sockets;
using System.Text;

namespace TercihPusula.Desktop;

/// <summary>
/// Serves the extracted bundle over loopback HTTP.
///
/// Why not <c>SetVirtualHostNameToFolderMapping</c>: every request on the virtual host cost ~2 s in
/// this environment (measured: about:blank 5 ms, a 95-byte file through the mapping 2015 ms, the same
/// file through this server ~2 ms), which made each page feel frozen. The mapping also has no
/// directory index, so <c>/kadrolar/</c> needed a special case; here the server handles it.
///
/// Why a raw <see cref="TcpListener"/> and not <see cref="HttpListener"/>: http.sys requires a URL
/// reservation and answered 400 for a non-elevated user on this machine. This is a tiny GET/HEAD
/// server with no dependencies, bound to 127.0.0.1 only.
///
/// The port is fixed so the origin — and therefore the saved preference list in localStorage — stays
/// stable between runs. If the port is busy a free one is used; the app still works, it just starts
/// with an empty list for that run.
/// </summary>
internal sealed class LoopbackServer : IDisposable
{
    private const int PreferredPort = 47821;
    private const int MaxRequestBytes = 16 * 1024;

    private static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8",
        [".css"] = "text/css; charset=utf-8",
        [".js"] = "text/javascript; charset=utf-8",
        [".json"] = "application/json; charset=utf-8",
        [".svg"] = "image/svg+xml",
        [".png"] = "image/png",
        [".woff2"] = "font/woff2",
        [".webmanifest"] = "application/manifest+json",
        [".xml"] = "application/xml; charset=utf-8",
        [".txt"] = "text/plain; charset=utf-8",
    };

    private readonly string _root;
    private string _lastError = "—";
    private TcpListener? _listener;
    private CancellationTokenSource? _stop;

    public LoopbackServer(string root) => _root = root;

    public int Port { get; private set; }
    public string Origin => $"http://127.0.0.1:{Port}";

    public void Start()
    {
        if (!TryBind(PreferredPort) && !TryBind(FreePort()))
            throw new InvalidOperationException($"Yerel sunucu 127.0.0.1:{Port} üzerinde başlatılamadı: {_lastError}");
        _stop = new CancellationTokenSource();
        _ = AcceptAsync(_stop.Token);
    }

    private bool TryBind(int port)
    {
        try
        {
            var listener = new TcpListener(IPAddress.Loopback, port) { Server = { NoDelay = true } };
            listener.Start(backlog: 64);
            _listener = listener;
            Port = port;
            return true;
        }
        catch (SocketException error)
        {
            _lastError = error.SocketErrorCode + " / " + error.Message;
            return false;
        }
    }

    private static int FreePort()
    {
        using var probe = new TcpListener(IPAddress.Loopback, 0);
        probe.Start();
        var port = ((IPEndPoint)probe.LocalEndpoint).Port;
        probe.Stop();
        return port;
    }

    private async Task AcceptAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            TcpClient client;
            try
            {
                client = await _listener!.AcceptTcpClientAsync(token);
            }
            catch (Exception error) when (error is OperationCanceledException or ObjectDisposedException or SocketException)
            {
                return;
            }

            _ = Task.Run(() => HandleAsync(client));
        }
    }

    private async Task HandleAsync(TcpClient client)
    {
        using var _ = client;
        try
        {
            await using var stream = client.GetStream();
            var request = await ReadRequestAsync(stream);
            if (request is null) return;

            var (method, rawPath) = request.Value;
            var path = rawPath;
            var query = path.IndexOf('?');
            if (query >= 0) path = path[..query];
            path = Uri.UnescapeDataString(path).TrimStart('/');
            if (path.Length == 0 || path.EndsWith('/')) path += "index.html";

            string file;
            try
            {
                file = AppPaths.SafeJoin(_root, path);
            }
            catch (InvalidOperationException)
            {
                await WriteAsync(stream, 400, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("bad path"), head: false);
                return;
            }

            if (!File.Exists(file))
            {
                await WriteAsync(stream, 404, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("not found"), method == "HEAD");
                return;
            }

            var body = await File.ReadAllBytesAsync(file);
            var contentType = Mime.TryGetValue(Path.GetExtension(file), out var mime) ? mime : "application/octet-stream";
            await WriteAsync(stream, 200, contentType, body, method == "HEAD");
        }
        catch (Exception error) when (error is IOException or SocketException or ObjectDisposedException or UnauthorizedAccessException)
        {
            // The page closed mid-request or the file vanished; nothing to report.
        }
    }

    private static async Task<(string Method, string Path)?> ReadRequestAsync(NetworkStream stream)
    {
        var buffer = new byte[MaxRequestBytes];
        var length = 0;
        while (length < buffer.Length)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(length));
            if (read == 0) return null;
            length += read;
            var text = Encoding.ASCII.GetString(buffer, 0, length);
            var end = text.IndexOf("\r\n\r\n", StringComparison.Ordinal);
            if (end < 0) continue;
            var line = text[..text.IndexOf("\r\n", StringComparison.Ordinal)];
            var parts = line.Split(' ');
            if (parts.Length < 2) return null;
            var method = parts[0].ToUpperInvariant();
            if (method is not ("GET" or "HEAD")) return ("GET", "/");
            return (method, parts[1]);
        }
        return null;
    }

    private static async Task WriteAsync(NetworkStream stream, int status, string contentType, byte[] body, bool head)
    {
        var reason = status switch { 200 => "OK", 400 => "Bad Request", 404 => "Not Found", _ => "Error" };
        var headers = new StringBuilder()
            .Append("HTTP/1.1 ").Append(status).Append(' ').Append(reason).Append("\r\n")
            .Append("Content-Type: ").Append(contentType).Append("\r\n")
            .Append("Content-Length: ").Append(body.Length).Append("\r\n")
            .Append("Cache-Control: no-store\r\n")
            .Append("X-Content-Type-Options: nosniff\r\n")
            .Append("Connection: close\r\n\r\n")
            .ToString();
        await stream.WriteAsync(Encoding.ASCII.GetBytes(headers));
        if (!head) await stream.WriteAsync(body);
        await stream.FlushAsync();
    }

    public void Dispose()
    {
        _stop?.Cancel();
        _stop?.Dispose();
        try
        {
            _listener?.Stop();
        }
        catch (SocketException)
        {
        }
    }
}
