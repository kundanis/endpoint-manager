// AI Guard -> prompt protection for AI desktop apps (ChatGPT, Claude, ... desktop programs), the part
// that runs in the user's session (inside the tray app). Windows doesn't let one program stop a
// paste into another, so this works on the clipboard instead: when an AI desktop app comes to the
// front while the clipboard holds sensitive data (the data types of the endpoint's AI Guard policy),
//  - Block: the text is taken off the clipboard while that app is in front;
//  - Mask:  the clipboard holds a copy with the sensitive parts masked while that app is in front;
//  - Warn:  the user is told, and the clipboard is left alone.
// The original text is put back as soon as the user switches to another program (unless something
// else was copied meanwhile). Each catch is shown to the user and reported to the agent with a
// masked sample only (POST /ai-guard/clipboard-events). Settings come from the local agent every
// few seconds (GET /ai-guard/clipboard).
//
// Compiled with TrayApp.cs by package-installer.ps1 (.NET Framework csc: C# 5, no newer syntax).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

class AiClipboardGuard
{
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    class Rule
    {
        public string Label;
        public Regex Pattern;
        public bool Luhn;
    }

    class Match
    {
        public string Label;
        public int Start;
        public int End;
    }

    readonly Action<string> notify;
    readonly SynchronizationContext ui;
    readonly System.Windows.Forms.Timer settingsTimer = new System.Windows.Forms.Timer { Interval = 10000 };
    readonly System.Windows.Forms.Timer focusTimer = new System.Windows.Forms.Timer { Interval = 400 };

    bool enabled;
    string action = "WARN";
    List<Rule> rules = new List<Rule>();
    Dictionary<string, string> appByProcess = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    string insideProcess;   // the AI desktop app in front, if any
    string stash;           // the user's own clipboard text, while a replacement is on the clipboard
    string placed;          // what this class put on the clipboard
    string lastWarned;      // text already warned about (one notice per copied text)

    public AiClipboardGuard(Action<string> notify)
    {
        this.notify = notify;
        ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        settingsTimer.Tick += (s, e) => LoadSettings();
        focusTimer.Tick += (s, e) => CheckFocus();
        settingsTimer.Start();
        focusTimer.Start();
        LoadSettings();
        Application.ApplicationExit += (s, e) => Restore();
    }

    void LoadSettings()
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            bool on;
            string act;
            List<Rule> list = new List<Rule>();
            Dictionary<string, string> apps = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                object s = AgentApi.Call("GET", "/ai-guard/clipboard", null);
                Dictionary<string, object> d = s as Dictionary<string, object>;
                on = AgentApi.Str(s, "enabled") == "True";
                act = AgentApi.Str(s, "action") ?? "WARN";
                if (d != null && d.ContainsKey("patterns"))
                {
                    foreach (object p in AgentApi.List(d["patterns"]))
                    {
                        try
                        {
                            RegexOptions o = RegexOptions.CultureInvariant;
                            if (AgentApi.Str(p, "anyCase") == "True") o |= RegexOptions.IgnoreCase;
                            list.Add(new Rule { Label = AgentApi.Str(p, "label"), Pattern = new Regex(AgentApi.Str(p, "pattern"), o), Luhn = AgentApi.Str(p, "luhn") == "True" });
                        }
                        catch
                        {
                            // a pattern .NET can't read is skipped
                        }
                    }
                }
                if (d != null && d.ContainsKey("keywordTypes"))
                {
                    foreach (object k in AgentApi.List(d["keywordTypes"]))
                    {
                        Dictionary<string, object> kd = k as Dictionary<string, object>;
                        if (kd == null || !kd.ContainsKey("values")) continue;
                        foreach (object v in AgentApi.List(kd["values"]))
                        {
                            string word = Convert.ToString(v).Trim();
                            if (word.Length < 2) continue;
                            string head = Regex.IsMatch(word, @"^\w") ? @"(?<!\w)" : "";
                            string tail = Regex.IsMatch(word, @"\w$") ? @"(?!\w)" : "";
                            list.Add(new Rule { Label = AgentApi.Str(k, "label"), Pattern = new Regex(head + Regex.Escape(word) + tail, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) });
                        }
                    }
                }
                if (d != null && d.ContainsKey("apps"))
                {
                    foreach (object a in AgentApi.List(d["apps"]))
                    {
                        Dictionary<string, object> ad = a as Dictionary<string, object>;
                        if (ad == null || !ad.ContainsKey("processes")) continue;
                        foreach (object p in AgentApi.List(ad["processes"])) apps[Convert.ToString(p)] = AgentApi.Str(a, "name");
                    }
                }
            }
            catch
            {
                return; // agent not answering: keep what was in force
            }
            ui.Post(_2 =>
            {
                enabled = on && list.Count > 0 && apps.Count > 0;
                action = act;
                rules = list;
                appByProcess = apps;
                if (!enabled) Restore();
            }, null);
        });
    }

    static string ForegroundProcess()
    {
        try
        {
            uint pid;
            GetWindowThreadProcessId(GetForegroundWindow(), out pid);
            if (pid == 0) return null;
            using (Process p = Process.GetProcessById((int)pid)) return p.ProcessName.ToLowerInvariant();
        }
        catch
        {
            return null;
        }
    }

    void CheckFocus()
    {
        if (!enabled && stash == null) return;
        string proc = ForegroundProcess();
        if (proc == null) return;
        bool isAi = enabled && appByProcess.ContainsKey(proc);
        if (isAi && insideProcess != proc)
        {
            insideProcess = proc;
            Inspect(proc);
        }
        else if (!isAi && insideProcess != null)
        {
            insideProcess = null;
            Restore();
        }
    }

    // The AI app just came to the front: look at what's on the clipboard.
    void Inspect(string proc)
    {
        string text;
        try
        {
            if (!Clipboard.ContainsText()) return;
            text = Clipboard.GetText();
        }
        catch
        {
            return; // clipboard busy
        }
        if (string.IsNullOrEmpty(text) || text == placed) return;
        List<Match> found = Find(text);
        if (found.Count == 0) return;

        string appName = appByProcess[proc];
        string labels = string.Join(", ", Labels(found).ToArray());
        string sample = Sample(text, found);
        if (action == "BLOCK" || action == "REDACT")
        {
            string replacement = action == "BLOCK"
                ? "[Removed by your organisation's AI policy: the copied text contains " + labels + " and can't be pasted into " + appName + ".]"
                : Redact(text, found);
            try
            {
                stash = text;
                placed = replacement;
                Clipboard.SetText(replacement);
            }
            catch
            {
                stash = null;
                placed = null;
                return;
            }
            notify(action == "BLOCK"
                ? "The copied text contains " + labels + ". Your organisation's AI policy doesn't allow pasting it into " + appName + ", so it was taken off the clipboard until you leave " + appName + "."
                : "The copied text contains " + labels + ". It was masked for pasting into " + appName + "; the original comes back when you leave " + appName + ".");
            Report(proc, action == "BLOCK" ? "BLOCKED" : "REDACTED", Labels(found), sample);
        }
        else if (lastWarned != text)
        {
            lastWarned = text;
            notify("The copied text contains " + labels + ". Your organisation's AI policy asks you not to paste it into " + appName + ".");
            Report(proc, "WARNED_CONTINUED", Labels(found), sample);
        }
    }

    // Puts the user's own text back - only if the clipboard still holds what this class placed.
    void Restore()
    {
        if (stash == null) return;
        try
        {
            if (Clipboard.ContainsText() && Clipboard.GetText() == placed) Clipboard.SetText(stash);
        }
        catch
        {
            // clipboard busy: the next focus change tries again only if still ours
            return;
        }
        stash = null;
        placed = null;
    }

    List<Match> Find(string text)
    {
        List<Match> found = new List<Match>();
        foreach (Rule r in rules)
        {
            foreach (System.Text.RegularExpressions.Match m in r.Pattern.Matches(text))
            {
                if (m.Length == 0) continue;
                string value = m.Value.TrimEnd(' ', '-', '\t');
                if (r.Luhn && !PassesLuhn(value)) continue;
                found.Add(new Match { Label = r.Label, Start = m.Index, End = m.Index + value.Length });
                if (found.Count >= 200) return found;
            }
        }
        found.Sort((a, b) => a.Start.CompareTo(b.Start));
        return found;
    }

    static List<string> Labels(List<Match> found)
    {
        List<string> labels = new List<string>();
        foreach (Match m in found) if (!labels.Contains(m.Label)) labels.Add(m.Label);
        return labels;
    }

    static bool PassesLuhn(string candidate)
    {
        int sum = 0;
        bool alt = false;
        for (int i = candidate.Length - 1; i >= 0; i--)
        {
            if (!char.IsDigit(candidate[i])) continue;
            int d = candidate[i] - '0';
            if (alt)
            {
                d *= 2;
                if (d > 9) d -= 9;
            }
            sum += d;
            alt = !alt;
        }
        return sum % 10 == 0;
    }

    // "4111 1111 1111 1111" -> "4111 •••• •••• 1111", same rule as the browser extension.
    static string Mask(string value)
    {
        int total = 0;
        foreach (char c in value) if (c != ' ' && c != '-') total++;
        int keep = value.Length >= 12 ? 4 : value.Length >= 6 ? 2 : 1;
        StringBuilder sb = new StringBuilder();
        int seen = 0;
        foreach (char c in value)
        {
            if (c == ' ' || c == '-') { sb.Append(c); continue; }
            seen++;
            sb.Append(seen <= keep || seen > total - keep ? c : '•');
        }
        return sb.ToString();
    }

    static string Redact(string text, List<Match> found)
    {
        StringBuilder sb = new StringBuilder();
        int at = 0;
        foreach (Match m in found)
        {
            if (m.Start < at) continue;
            sb.Append(text, at, m.Start - at);
            sb.Append(Mask(text.Substring(m.Start, m.End - m.Start)));
            at = m.End;
        }
        sb.Append(text.Substring(at));
        return sb.ToString();
    }

    static string Sample(string text, List<Match> found)
    {
        List<string> parts = new List<string>();
        for (int i = 0; i < found.Count && i < 3; i++) parts.Add(Mask(text.Substring(found[i].Start, found[i].End - found[i].Start)));
        string s = string.Join(", ", parts.ToArray());
        return s.Length > 300 ? s.Substring(0, 300) : s;
    }

    static void Report(string proc, string outcome, List<string> labels, string sample)
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            try
            {
                Dictionary<string, object> body = new Dictionary<string, object>();
                body["process"] = proc + ".exe";
                body["action"] = outcome;
                body["dataTypes"] = labels.ToArray();
                body["maskedSample"] = sample;
                AgentApi.Call("POST", "/ai-guard/clipboard-events", body);
            }
            catch
            {
                // reporting never affects what the user sees
            }
        });
    }
}
