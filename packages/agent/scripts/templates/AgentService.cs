// Endpoint IQ Agent - Windows service host (EndpointIQAgentService.exe, service "EndpointIQAgent").
//
// Node.js can't register itself as a Windows service, so this small host does two jobs:
//  1. Runs the agent (node\node.exe app\dist\index.js) as LocalSystem, restarting it 10 seconds
//     after it exits for any reason, and stopping it (with everything it started) when the
//     service is stopped. EIQ_RUN_MODE=service tells the agent it is running under the service.
//  2. Starts the Endpoint IQ tray app (tray\EndpointIQTray.exe) in every signed-in user's
//     session, as that user: when the service starts, when someone signs in, and again every
//     minute in any session where it isn't running (so closing it in Task Manager doesn't
//     remove it for good).
//
// Compiled by package-installer.ps1 with the C# compiler that comes with the .NET Framework,
// like the setup exe - no third-party service wrapper.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.ServiceProcess;
using System.Threading;

public class EndpointIQAgentService : ServiceBase
{
    const string ServiceNameConst = "EndpointIQAgent";
    readonly string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
    Process agent;
    Thread supervisor;
    Timer trayTimer;
    volatile bool stopping;
    readonly object agentLock = new object();

    public EndpointIQAgentService()
    {
        ServiceName = ServiceNameConst;
        CanStop = true;
        CanShutdown = true;
        CanHandleSessionChangeEvent = true;
        AutoLog = false;
    }

    public static void Main()
    {
        ServiceBase.Run(new EndpointIQAgentService());
    }

    string LogPath { get { return Path.Combine(installDir, @"app\.state\service.log"); } }

    void Log(string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath));
            FileInfo info = new FileInfo(LogPath);
            if (info.Exists && info.Length > 1024 * 1024) File.Delete(LogPath);
            File.AppendAllText(LogPath, DateTime.UtcNow.ToString("o") + " " + message + Environment.NewLine);
        }
        catch { }
    }

    protected override void OnStart(string[] args)
    {
        stopping = false;
        supervisor = new Thread(Supervise) { IsBackground = true, Name = "agent-supervisor" };
        supervisor.Start();
        trayTimer = new Timer(_ => StartTrayEverywhere(), null, TimeSpan.FromSeconds(5), TimeSpan.FromMinutes(1));
        Log("Service started");
    }

    protected override void OnStop()
    {
        stopping = true;
        if (trayTimer != null) trayTimer.Dispose();
        StopAgent();
        Log("Service stopped");
    }

    protected override void OnShutdown()
    {
        OnStop();
    }

    protected override void OnSessionChange(SessionChangeDescription change)
    {
        if (change.Reason == SessionChangeReason.SessionLogon || change.Reason == SessionChangeReason.SessionUnlock ||
            change.Reason == SessionChangeReason.RemoteConnect || change.Reason == SessionChangeReason.ConsoleConnect)
        {
            int sessionId = change.SessionId;
            ThreadPool.QueueUserWorkItem(_ =>
            {
                Thread.Sleep(3000); // let the desktop finish loading
                StartTrayInSession(sessionId);
            });
        }
    }

    // ---- Agent process ----------------------------------------------------------------------

    void Supervise()
    {
        while (!stopping)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(installDir, @"node\node.exe"),
                    "\"" + Path.Combine(installDir, @"app\dist\index.js") + "\"")
                {
                    WorkingDirectory = installDir,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                psi.EnvironmentVariables["EIQ_RUN_MODE"] = "service";
                Process p = Process.Start(psi);
                lock (agentLock) agent = p;
                Log("Agent started (pid " + p.Id + ")");
                p.WaitForExit();
                if (!stopping) Log("Agent exited with code " + p.ExitCode + "; restarting in 10 seconds");
            }
            catch (Exception e)
            {
                Log("Couldn't start the agent: " + e.Message);
            }
            for (int i = 0; i < 10 && !stopping; i++) Thread.Sleep(1000);
        }
    }

    // Ends the agent and everything it started (running commands, installers).
    void StopAgent()
    {
        Process p;
        lock (agentLock) p = agent;
        if (p == null) return;
        try
        {
            if (!p.HasExited)
            {
                ProcessStartInfo kill = new ProcessStartInfo("taskkill.exe", "/PID " + p.Id + " /T /F")
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                };
                using (Process k = Process.Start(kill)) k.WaitForExit(15000);
            }
        }
        catch { }
    }

    // ---- Tray app -----------------------------------------------------------------------------

    string TrayExe { get { return Path.Combine(installDir, @"tray\EndpointIQTray.exe"); } }

    void StartTrayEverywhere()
    {
        if (stopping) return;
        IntPtr sessions = IntPtr.Zero;
        int count = 0;
        try
        {
            if (!WTSEnumerateSessions(IntPtr.Zero, 0, 1, out sessions, out count)) return;
            int size = Marshal.SizeOf(typeof(WTS_SESSION_INFO));
            for (int i = 0; i < count; i++)
            {
                WTS_SESSION_INFO info = (WTS_SESSION_INFO)Marshal.PtrToStructure(new IntPtr(sessions.ToInt64() + i * size), typeof(WTS_SESSION_INFO));
                if (info.State == WTS_CONNECTSTATE_CLASS.WTSActive && info.SessionID != 0) StartTrayInSession(info.SessionID);
            }
        }
        catch (Exception e)
        {
            Log("Tray check failed: " + e.Message);
        }
        finally
        {
            if (sessions != IntPtr.Zero) WTSFreeMemory(sessions);
        }
    }

    bool TrayRunningInSession(int sessionId)
    {
        foreach (Process p in Process.GetProcessesByName("EndpointIQTray"))
        {
            try { if (p.SessionId == sessionId) return true; }
            catch { }
        }
        return false;
    }

    void StartTrayInSession(int sessionId)
    {
        if (stopping || !File.Exists(TrayExe) || TrayRunningInSession(sessionId)) return;

        IntPtr userToken = IntPtr.Zero, primaryToken = IntPtr.Zero, environment = IntPtr.Zero;
        try
        {
            // Only works for a session with a signed-in user; the lock screen and an empty RDP
            // session have none, which is fine - it is tried again at sign-in and every minute.
            if (!WTSQueryUserToken((uint)sessionId, out userToken)) return;
            if (!DuplicateTokenEx(userToken, 0x10000000 /* MAXIMUM_ALLOWED */, IntPtr.Zero, 2 /* SecurityImpersonation */,
                    1 /* TokenPrimary */, out primaryToken)) return;
            if (!CreateEnvironmentBlock(out environment, primaryToken, false)) environment = IntPtr.Zero;

            STARTUPINFO si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            si.lpDesktop = @"winsta0\default";
            PROCESS_INFORMATION pi;
            const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
            string commandLine = "\"" + TrayExe + "\"";
            if (CreateProcessAsUser(primaryToken, TrayExe, commandLine, IntPtr.Zero, IntPtr.Zero, false,
                    CREATE_UNICODE_ENVIRONMENT, environment, Path.GetDirectoryName(TrayExe), ref si, out pi))
            {
                CloseHandle(pi.hThread);
                CloseHandle(pi.hProcess);
            }
            else
            {
                Log("Couldn't start the tray app in session " + sessionId + ": " + new Win32Exception(Marshal.GetLastWin32Error()).Message);
            }
        }
        finally
        {
            if (environment != IntPtr.Zero) DestroyEnvironmentBlock(environment);
            if (primaryToken != IntPtr.Zero) CloseHandle(primaryToken);
            if (userToken != IntPtr.Zero) CloseHandle(userToken);
        }
    }

    // ---- Win32 --------------------------------------------------------------------------------

    enum WTS_CONNECTSTATE_CLASS { WTSActive, WTSConnected, WTSConnectQuery, WTSShadow, WTSDisconnected, WTSIdle, WTSListen, WTSReset, WTSDown, WTSInit }

    [StructLayout(LayoutKind.Sequential)]
    struct WTS_SESSION_INFO
    {
        public int SessionID;
        [MarshalAs(UnmanagedType.LPStr)] public string pWinStationName;
        public WTS_CONNECTSTATE_CLASS State;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO
    {
        public int cb;
        public string lpReserved, lpDesktop, lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public int dwProcessId, dwThreadId;
    }

    [DllImport("wtsapi32.dll", SetLastError = true)]
    static extern bool WTSEnumerateSessions(IntPtr hServer, int reserved, int version, out IntPtr sessionInfo, out int count);

    [DllImport("wtsapi32.dll")]
    static extern void WTSFreeMemory(IntPtr memory);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    static extern bool WTSQueryUserToken(uint sessionId, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    static extern bool DuplicateTokenEx(IntPtr existingToken, uint desiredAccess, IntPtr tokenAttributes, int impersonationLevel,
        int tokenType, out IntPtr newToken);

    [DllImport("userenv.dll", SetLastError = true)]
    static extern bool CreateEnvironmentBlock(out IntPtr environment, IntPtr token, bool inherit);

    [DllImport("userenv.dll", SetLastError = true)]
    static extern bool DestroyEnvironmentBlock(IntPtr environment);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcessAsUser(IntPtr token, string applicationName, string commandLine, IntPtr processAttributes,
        IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory,
        ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);
}
