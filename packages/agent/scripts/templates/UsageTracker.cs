// Endpoint IQ tray app - user productivity: time per application and website. Compiled together
// with TrayApp.cs into tray\EndpointIQTray.exe.
//
// Every 5 seconds, notes which application has the foreground window - and, for a browser, the
// domain of the active tab, read from its address bar - unless the user has been idle for
// 2 minutes or the screen is locked. The totals go to the agent every 5 minutes. Only the
// program's name and the domain are kept: never window titles, page addresses or content.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Automation;

class UsageTracker
{
    const int TickMs = 5000;
    const int FlushMs = 5 * 60 * 1000;
    const uint IdleAfterMs = 2 * 60 * 1000;
    static readonly HashSet<string> Browsers = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        { "chrome", "msedge", "firefox", "brave", "opera", "vivaldi" };
    static readonly Regex Host = new Regex(@"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$");

    // "APP|winword" -> (label, seconds)
    readonly Dictionary<string, KeyValuePair<string, int>> totals = new Dictionary<string, KeyValuePair<string, int>>();
    readonly Dictionary<string, string> labels = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
    readonly Dictionary<IntPtr, AutomationElement> addressBars = new Dictionary<IntPtr, AutomationElement>();
    readonly Dictionary<IntPtr, string> lastDomain = new Dictionary<IntPtr, string>();
    readonly object gate = new object();
    readonly Timer tick, flush;
    readonly int ownPid = Process.GetCurrentProcess().Id;
    int busy;
    DateTime lastTick = DateTime.UtcNow;

    public UsageTracker()
    {
        tick = new Timer(_ => Tick(), null, TickMs, TickMs);
        flush = new Timer(_ => Flush(), null, FlushMs, FlushMs);
    }

    void Tick()
    {
        if (Interlocked.Exchange(ref busy, 1) == 1) return; // a slow browser is still answering
        try
        {
            DateTime now = DateTime.UtcNow;
            int seconds = (int)Math.Min(Math.Round((now - lastTick).TotalSeconds), 10);
            lastTick = now;
            if (seconds <= 0 || IdleMs() >= IdleAfterMs) return;

            IntPtr window = GetForegroundWindow();
            if (window == IntPtr.Zero) return;
            uint pid;
            GetWindowThreadProcessId(window, out pid);
            Process process = ProcessOf(window, pid);
            if (process == null || process.Id == ownPid) return;

            string exe = process.ProcessName.ToLowerInvariant();
            if (exe == "lockapp" || exe == "logonui") return;
            Add("APP", exe, LabelOf(process), seconds);

            if (Browsers.Contains(exe))
            {
                string domain = DomainOf(window, exe);
                if (domain != null) Add("WEB", domain, domain, seconds);
            }
        }
        catch { }
        finally
        {
            Interlocked.Exchange(ref busy, 0);
        }
    }

    void Add(string kind, string key, string label, int seconds)
    {
        string id = kind + "|" + key;
        lock (gate)
        {
            KeyValuePair<string, int> seen;
            int total = totals.TryGetValue(id, out seen) ? seen.Value : 0;
            totals[id] = new KeyValuePair<string, int>(label, total + seconds);
        }
    }

    public void Flush()
    {
        Dictionary<string, KeyValuePair<string, int>> batch;
        lock (gate)
        {
            if (totals.Count == 0) return;
            batch = new Dictionary<string, KeyValuePair<string, int>>(totals);
            totals.Clear();
        }

        List<object> items = new List<object>();
        foreach (KeyValuePair<string, KeyValuePair<string, int>> e in batch)
        {
            int bar = e.Key.IndexOf('|');
            items.Add(new Dictionary<string, object>
            {
                { "kind", e.Key.Substring(0, bar) },
                { "key", e.Key.Substring(bar + 1) },
                { "label", e.Value.Key },
                { "seconds", Math.Min(e.Value.Value, 3600) },
            });
            if (items.Count == 500) break;
        }

        try
        {
            // The user name is set by the agent, from the user its key belongs to (AgentApi).
            AgentApi.Call("POST", "/usage", new Dictionary<string, object> { { "items", items } });
        }
        catch
        {
            // The agent or server is unavailable: keep the time for the next report.
            lock (gate)
            {
                foreach (KeyValuePair<string, KeyValuePair<string, int>> e in batch)
                {
                    KeyValuePair<string, int> seen;
                    int total = totals.TryGetValue(e.Key, out seen) ? seen.Value : 0;
                    if (totals.Count < 2000) totals[e.Key] = new KeyValuePair<string, int>(e.Value.Key, Math.Min(total + e.Value.Value, 86400));
                }
            }
        }
    }

    // Store apps run inside ApplicationFrameHost; the real app owns one of its child windows.
    static Process ProcessOf(IntPtr window, uint pid)
    {
        Process process;
        try { process = Process.GetProcessById((int)pid); }
        catch { return null; }
        if (!process.ProcessName.Equals("ApplicationFrameHost", StringComparison.OrdinalIgnoreCase)) return process;

        Process inner = null;
        EnumChildWindows(window, (child, param) =>
        {
            uint childPid;
            GetWindowThreadProcessId(child, out childPid);
            if (childPid == pid) return true;
            try { inner = Process.GetProcessById((int)childPid); } catch { }
            return false;
        }, IntPtr.Zero);
        return inner ?? process;
    }

    // The program's own description (e.g. "Microsoft Excel"), else its executable name.
    string LabelOf(Process process)
    {
        string name = process.ProcessName;
        string label;
        if (labels.TryGetValue(name, out label)) return label;
        label = name;
        try
        {
            string description = process.MainModule.FileVersionInfo.FileDescription;
            if (!string.IsNullOrWhiteSpace(description)) label = description.Trim();
        }
        catch { } // e.g. an elevated program: its file can't be read from here
        if (label.Length > 300) label = label.Substring(0, 300);
        labels[name] = label;
        return label;
    }

    // The domain shown in the browser's address bar. While the user is typing in it, the last
    // domain seen in that window is used instead.
    string DomainOf(IntPtr window, string exe)
    {
        try
        {
            AutomationElement bar;
            if (!addressBars.TryGetValue(window, out bar))
            {
                AutomationElement root = AutomationElement.FromHandle(window);
                Condition condition = exe == "firefox"
                    ? (Condition)new PropertyCondition(AutomationElement.AutomationIdProperty, "urlbar-input")
                    : new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Edit);
                bar = root.FindFirst(TreeScope.Descendants, condition);
                if (bar == null) return null;
                if (addressBars.Count > 50) addressBars.Clear();
                addressBars[window] = bar;
            }

            string last;
            lastDomain.TryGetValue(window, out last);
            if (bar.Current.HasKeyboardFocus) return last;

            object pattern;
            if (!bar.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) return last;
            string domain = ParseDomain(((ValuePattern)pattern).Current.Value);
            if (domain != null)
            {
                if (lastDomain.Count > 50) lastDomain.Clear();
                lastDomain[window] = domain;
            }
            return domain;
        }
        catch (ElementNotAvailableException)
        {
            addressBars.Remove(window); // the window changed; look the address bar up again
            return null;
        }
        catch
        {
            return null;
        }
    }

    // "https://www.youtube.com/watch?v=x" or "youtube.com/watch" -> "youtube.com"; null for a
    // search being typed or a browser page (chrome://, edge://, about:, file://).
    public static string ParseDomain(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        string v = value.Trim().ToLowerInvariant();
        if (v.Contains(" ")) return null;
        int scheme = v.IndexOf("://", StringComparison.Ordinal);
        if (scheme >= 0)
        {
            string s = v.Substring(0, scheme);
            if (s != "http" && s != "https") return null;
            v = v.Substring(scheme + 3);
        }
        else if (v.StartsWith("about:") || v.StartsWith("chrome:") || v.StartsWith("edge:"))
        {
            return null;
        }
        int end = v.IndexOfAny(new[] { '/', '?', '#' });
        if (end >= 0) v = v.Substring(0, end);
        int at = v.LastIndexOf('@');
        if (at >= 0) v = v.Substring(at + 1);
        int colon = v.IndexOf(':');
        if (colon >= 0) v = v.Substring(0, colon);
        if (v.StartsWith("www.")) v = v.Substring(4);
        return v.Length <= 255 && Host.IsMatch(v) ? v : null;
    }

    static uint IdleMs()
    {
        LASTINPUTINFO info = new LASTINPUTINFO();
        info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
        if (!GetLastInputInfo(ref info)) return 0;
        return unchecked((uint)Environment.TickCount - info.dwTime);
    }

    [StructLayout(LayoutKind.Sequential)]
    struct LASTINPUTINFO
    {
        public uint cbSize;
        public uint dwTime;
    }

    delegate bool EnumWindowsProc(IntPtr window, IntPtr param);

    [DllImport("user32.dll")]
    static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

    [DllImport("user32.dll")]
    static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr param);

    [DllImport("user32.dll")]
    static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
}
