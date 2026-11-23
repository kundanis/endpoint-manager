// EPM -> Screenshot blocking, the part that runs in the user's session (inside the tray app).
// Asks the local agent every few seconds what to block (GET /screenshot-block), then:
//  - keys: a low-level keyboard hook swallows Print Screen (alone, with Alt or Win) and
//    Win+Shift+S / Win+Shift+R before Windows sees them;
//  - tools: screenshot programs started in this session are closed straight away;
//  - clipboard (optional): any picture placed on the clipboard is removed.
// Each blocked attempt is shown to the user and reported to the agent (POST /screenshot-block/events).
// The agent also closes listed tools in every session on its own sync, and turns off Snipping Tool
// and Game Bar capture by machine policy, so closing the tray app opens at most a short gap
// (the service starts it again within a minute).
//
// Compiled with TrayApp.cs by package-installer.ps1 (.NET Framework csc: C# 5, no newer syntax).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

class ScreenshotBlocker
{
    const int WH_KEYBOARD_LL = 13;
    const int WM_KEYDOWN = 0x0100, WM_SYSKEYDOWN = 0x0104, WM_KEYUP = 0x0101, WM_SYSKEYUP = 0x0105;
    const int VK_SNAPSHOT = 0x2C, VK_LWIN = 0x5B, VK_RWIN = 0x5C, VK_SHIFT = 0x10, VK_MENU = 0x12;
    const int VK_S = 0x53, VK_R = 0x52;

    [StructLayout(LayoutKind.Sequential)]
    struct KBDLLHOOKSTRUCT { public int vkCode; public int scanCode; public int flags; public int time; public IntPtr extra; }

    delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)] static extern IntPtr SetWindowsHookEx(int idHook, HookProc fn, IntPtr hMod, uint threadId);
    [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int vKey);
    [DllImport("kernel32.dll")] static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    const uint KEYEVENTF_KEYUP = 0x0002;

    readonly Action<string> notify;
    readonly SynchronizationContext ui;
    readonly HookProc hookProc; // kept referenced so the GC doesn't collect the delegate
    readonly System.Windows.Forms.Timer settingsTimer = new System.Windows.Forms.Timer { Interval = 10000 };
    readonly System.Windows.Forms.Timer toolTimer = new System.Windows.Forms.Timer { Interval = 1000 };
    readonly object queueLock = new object();
    readonly List<Dictionary<string, object>> queue = new List<Dictionary<string, object>>();
    IntPtr hook = IntPtr.Zero;
    ClipboardWatcher clipboard;
    volatile bool blockKeys, blockTools, blockClipboard;
    HashSet<string> tools = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    DateTime lastNotice = DateTime.MinValue;
    int sessionId = Process.GetCurrentProcess().SessionId;

    public ScreenshotBlocker(Action<string> notify)
    {
        this.notify = notify;
        ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        hookProc = OnKey;
        settingsTimer.Tick += (s, e) => LoadSettings();
        settingsTimer.Start();
        toolTimer.Tick += (s, e) => CloseTools();
        LoadSettings();
        Application.ApplicationExit += (s, e) => Stop();
    }

    void LoadSettings()
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            bool keys = false, toolsOn = false, clip = false;
            HashSet<string> list = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            try
            {
                object s = AgentApi.Call("GET", "/screenshot-block", null);
                keys = AgentApi.Str(s, "blockKeys") == "True";
                clip = AgentApi.Str(s, "blockClipboardImages") == "True";
                Dictionary<string, object> d = s as Dictionary<string, object>;
                if (d != null && d.ContainsKey("tools"))
                    foreach (object t in AgentApi.List(d["tools"])) list.Add(Convert.ToString(t));
                toolsOn = list.Count > 0;
            }
            catch
            {
                // Agent not answering: keep what was in force (the agent's own checks still run).
                return;
            }
            ui.Post(_2 => Apply(keys, toolsOn, clip, list), null);
            Flush();
        });
    }

    void Apply(bool keys, bool toolsOn, bool clip, HashSet<string> list)
    {
        blockKeys = keys;
        blockTools = toolsOn;
        blockClipboard = clip;
        tools = list;

        if (keys && hook == IntPtr.Zero)
        {
            using (Process p = Process.GetCurrentProcess())
                hook = SetWindowsHookEx(WH_KEYBOARD_LL, hookProc, GetModuleHandle(p.MainModule.ModuleName), 0);
        }
        else if (!keys && hook != IntPtr.Zero)
        {
            UnhookWindowsHookEx(hook);
            hook = IntPtr.Zero;
        }

        if (toolsOn) toolTimer.Start(); else toolTimer.Stop();

        if (clip && clipboard == null) clipboard = new ClipboardWatcher(OnClipboardChanged);
        else if (!clip && clipboard != null)
        {
            clipboard.Dispose();
            clipboard = null;
        }
    }

    void Stop()
    {
        if (hook != IntPtr.Zero) UnhookWindowsHookEx(hook);
        hook = IntPtr.Zero;
        if (clipboard != null) clipboard.Dispose();
        Flush();
    }

    static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }

    // Runs on the UI thread for every key press in the session: must return quickly.
    IntPtr OnKey(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && blockKeys)
        {
            int msg = wParam.ToInt32();
            KBDLLHOOKSTRUCT k = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT));
            bool isDown = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
            bool isKey = isDown || msg == WM_KEYUP || msg == WM_SYSKEYUP;
            if (isKey)
            {
                bool win = Down(VK_LWIN) || Down(VK_RWIN);
                string what = null;
                if (k.vkCode == VK_SNAPSHOT)
                    what = win ? "Win+Print Screen" : Down(VK_MENU) ? "Alt+Print Screen" : "Print Screen";
                else if (win && Down(VK_SHIFT) && k.vkCode == VK_S)
                    what = "Win+Shift+S";
                else if (win && Down(VK_SHIFT) && k.vkCode == VK_R)
                    what = "Win+Shift+R";
                if (what != null)
                {
                    // With Win held, a swallowed key would leave Windows seeing a lone Win press and
                    // open the Start menu on release; an unassigned key in between prevents that.
                    if (isDown && win)
                    {
                        keybd_event(0xFF, 0, 0, UIntPtr.Zero);
                        keybd_event(0xFF, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
                    }
                    if (isDown) Blocked("KEY", what);
                    return (IntPtr)1; // swallowed: Windows never sees it
                }
            }
        }
        return CallNextHookEx(hook, nCode, wParam, lParam);
    }

    void CloseTools()
    {
        if (!blockTools || tools.Count == 0) return;
        foreach (Process p in Process.GetProcesses())
        {
            try
            {
                if (p.SessionId != sessionId || !tools.Contains(p.ProcessName + ".exe")) continue;
                string name = p.ProcessName + ".exe";
                p.Kill();
                Blocked("TOOL", name);
            }
            catch
            {
                // already gone, or not ours to close
            }
            finally
            {
                p.Dispose();
            }
        }
    }

    void OnClipboardChanged()
    {
        if (!blockClipboard) return;
        try
        {
            if (!Clipboard.ContainsImage()) return;
            Clipboard.Clear();
            Blocked("CLIPBOARD", "Picture copied to the clipboard");
        }
        catch
        {
            // clipboard held open by another program - next change will be checked
        }
    }

    void Blocked(string kind, string detail)
    {
        Dictionary<string, object> e = new Dictionary<string, object>();
        // No user name: the agent sets it, from the user its key belongs to (AgentApi).
        e["kind"] = kind;
        e["detail"] = detail;
        e["occurredAt"] = DateTime.UtcNow.ToString("o");
        lock (queueLock) { if (queue.Count < 500) queue.Add(e); }

        if ((DateTime.UtcNow - lastNotice).TotalSeconds > 5)
        {
            lastNotice = DateTime.UtcNow;
            string text = kind == "TOOL"
                ? detail + " was closed: screenshots are blocked on this PC by your organization."
                : "Screenshots are blocked on this PC by your organization.";
            ui.Post(_ => notify(text), null);
        }
        ThreadPool.QueueUserWorkItem(_ => { Thread.Sleep(2000); Flush(); });
    }

    void Flush()
    {
        List<Dictionary<string, object>> batch;
        lock (queueLock)
        {
            if (queue.Count == 0) return;
            batch = new List<Dictionary<string, object>>(queue);
            queue.Clear();
        }
        try
        {
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["events"] = batch;
            AgentApi.Call("POST", "/screenshot-block/events", body);
        }
        catch
        {
            lock (queueLock) { if (queue.Count + batch.Count <= 500) queue.InsertRange(0, batch); }
        }
    }
}

// A hidden window that is told about every clipboard change (AddClipboardFormatListener).
class ClipboardWatcher : NativeWindow, IDisposable
{
    const int WM_CLIPBOARDUPDATE = 0x031D;
    [DllImport("user32.dll", SetLastError = true)] static extern bool AddClipboardFormatListener(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] static extern bool RemoveClipboardFormatListener(IntPtr hwnd);

    readonly Action changed;

    public ClipboardWatcher(Action changed)
    {
        this.changed = changed;
        CreateHandle(new CreateParams());
        AddClipboardFormatListener(Handle);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_CLIPBOARDUPDATE) changed();
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (Handle != IntPtr.Zero)
        {
            RemoveClipboardFormatListener(Handle);
            DestroyHandle();
        }
    }
}
