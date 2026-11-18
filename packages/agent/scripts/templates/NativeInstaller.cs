using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Threading;

// The "setup without PowerShell" variant (EndpointProAgentSetup-NoPowerShell.exe): does exactly
// what install.ps1 + register-service.ps1 do, step for step, without starting powershell.exe -
// for machines where Group Policy (Software Restriction Policies / AppLocker) blocks it. Only
// Windows' own tools are used (schtasks, sc, icacls, takeown, taskkill). The installed agent is
// the same in both variants. Keep the two in step: any change to install.ps1 or
// register-service.ps1 belongs here too.
internal static class NativeInstaller
{
    private const string LegacyTaskName = "EndpointProAgent"; // agents before 0.2.23 ran as this scheduled task
    private const string ServiceName = "EndpointIQAgent";
    private const string WatchdogTaskName = "EndpointProWatchdog";

    // Returns null on success, otherwise what went wrong (shown in the failure dialog).
    internal static string Install(string sourceDir, string serverUrl, string enrollmentToken)
    {
        if (string.IsNullOrWhiteSpace(enrollmentToken)) return "An enrollment token is required.";

        List<string> serverUrls = new List<string>();
        foreach (string part in (serverUrl ?? "").Split(','))
        {
            string url = part.Trim().TrimEnd('/');
            if (url.Length > 0) serverUrls.Add(url);
        }
        if (serverUrls.Count == 0) return "A server URL is required.";

        string installDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), @"EndpointPro\Agent");

        // Stop an existing installation before updating it.
        bool taskExists = Run("schtasks.exe", "/query /tn " + LegacyTaskName) == 0;
        bool serviceExists = ServiceExists();
        if (taskExists || serviceExists)
        {
            // The watchdog first - it would otherwise start the agent again mid-copy. Then the
            // agent (service, or the scheduled task older versions used) and the tray app.
            Run("schtasks.exe", "/change /tn " + WatchdogTaskName + " /disable");
            Run("schtasks.exe", "/end /tn " + WatchdogTaskName);
            if (serviceExists) StopService();
            Run("schtasks.exe", "/change /tn " + LegacyTaskName + " /disable");
            Run("schtasks.exe", "/end /tn " + LegacyTaskName);
            Run("taskkill.exe", "/IM EndpointIQTray.exe /F");
            Thread.Sleep(2000);

            // The folder may be locked down from a prior install: take ownership, then reset
            // its permissions so the new files can be written (re-applied below).
            if (Directory.Exists(installDir))
            {
                Run("takeown.exe", "/F \"" + installDir + "\" /R /D Y");
                Run("icacls.exe", "\"" + installDir + "\" /reset /T /Q");
            }
        }

        try
        {
            Directory.CreateDirectory(installDir);
            CopyDirectory(Path.Combine(sourceDir, "node"), Path.Combine(installDir, "node"));
            CopyDirectory(Path.Combine(sourceDir, "app"), Path.Combine(installDir, "app"));
            CopyDirectory(Path.Combine(sourceDir, "tray"), Path.Combine(installDir, "tray"));
            foreach (string file in new[] { "EndpointIQAgentService.exe", "register-service.ps1", "watchdog.ps1" })
            {
                File.Copy(Path.Combine(sourceDir, file), Path.Combine(installDir, file), true);
            }

            // config.json sits in <installDir>\app (config.ts resolves it from dist's parent).
            // ASCII, no BOM - JSON.parse rejects one.
            StringBuilder urls = new StringBuilder();
            foreach (string url in serverUrls)
            {
                if (urls.Length > 0) urls.Append(", ");
                urls.Append(JsonString(url));
            }
            string configJson = "{\r\n    \"serverUrl\": " + JsonString(serverUrls[0]) +
                ",\r\n    \"serverUrls\": [ " + urls + " ],\r\n    \"enrollmentToken\": " + JsonString(enrollmentToken) + "\r\n}";
            File.WriteAllText(Path.Combine(installDir, @"app\config.json"), configJson, Encoding.ASCII);
        }
        catch (Exception ex)
        {
            return "Could not copy the agent files to " + installDir + ": " + ex.Message;
        }

        // Watchdog task - the same definition install.ps1 registers.
        string watchdogScript = Path.Combine(installDir, "watchdog.ps1");
        string watchdogXml =
            "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n" +
            "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\r\n" +
            "  <Triggers>\r\n" +
            "    <TimeTrigger>\r\n" +
            "      <Repetition>\r\n" +
            "        <Interval>PT5M</Interval>\r\n" +
            "      </Repetition>\r\n" +
            "      <StartBoundary>2020-01-01T00:00:00</StartBoundary>\r\n" +
            "      <Enabled>true</Enabled>\r\n" +
            "    </TimeTrigger>\r\n" +
            "    <BootTrigger>\r\n" +
            "      <Enabled>true</Enabled>\r\n" +
            "    </BootTrigger>\r\n" +
            "  </Triggers>\r\n" +
            "  <Principals>\r\n" +
            "    <Principal id=\"Author\">\r\n" +
            "      <UserId>S-1-5-18</UserId>\r\n" +
            "      <RunLevel>HighestAvailable</RunLevel>\r\n" +
            "    </Principal>\r\n" +
            "  </Principals>\r\n" +
            "  <Settings>\r\n" +
            "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n" +
            "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n" +
            "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\r\n" +
            "    <StartWhenAvailable>true</StartWhenAvailable>\r\n" +
            "    <Hidden>true</Hidden>\r\n" +
            "    <ExecutionTimeLimit>PT2M</ExecutionTimeLimit>\r\n" +
            "  </Settings>\r\n" +
            "  <Actions Context=\"Author\">\r\n" +
            "    <Exec>\r\n" +
            "      <Command>powershell.exe</Command>\r\n" +
            "      <Arguments>-NoProfile -ExecutionPolicy Bypass -File \"" + watchdogScript + "\"</Arguments>\r\n" +
            "      <WorkingDirectory>" + installDir + "</WorkingDirectory>\r\n" +
            "    </Exec>\r\n" +
            "  </Actions>\r\n" +
            "</Task>\r\n";
        // Not checked, as in install.ps1: without the watchdog the agent still runs.
        CreateTask(WatchdogTaskName, watchdogXml);

        int registerExitCode = RegisterService(installDir);
        Thread.Sleep(2000);
        // 3 = Windows wouldn't run the service program; the agent runs as the scheduled task instead.
        if (registerExitCode == 0 || registerExitCode == 3) return null;
        return "Failed to register the Endpoint IQ Agent service (exit code " + registerExitCode + ").";
    }

    // register-service.ps1 (install mode): lock the folder down, create/configure the service and
    // start it; if Windows won't run it, fall back to the scheduled task. 0 service running,
    // 3 running as the task, 1/2 failed.
    private static int RegisterService(string installDir)
    {
        string serviceExe = Path.Combine(installDir, "EndpointIQAgentService.exe");
        string trayDir = Path.Combine(installDir, "tray");
        string blockedMarker = Path.Combine(installDir, @"app\.state\service-blocked.txt");
        if (!File.Exists(serviceExe)) return 1;

        bool migrating = LegacyTaskExists();

        // 1. Tamper resistance: the folder belongs to SYSTEM; administrators can read it; users
        // can read the tray app's folder.
        string dir = "\"" + installDir + "\"";
        Run("icacls.exe", dir + " /inheritance:r /Q");
        Run("icacls.exe", dir + " /grant:r *S-1-5-18:(OI)(CI)F /Q");
        Run("icacls.exe", dir + " /grant:r *S-1-5-32-544:(OI)(CI)RX /Q");
        string installer = WindowsIdentity.GetCurrent().Name;
        if (!installer.EndsWith("SYSTEM", StringComparison.OrdinalIgnoreCase))
        {
            Run("icacls.exe", dir + " /remove:g \"" + installer + "\" /Q");
        }
        if (Directory.Exists(trayDir)) Run("icacls.exe", "\"" + trayDir + "\" /grant *S-1-5-32-545:(OI)(CI)RX /Q");

        // 2. The service: automatic start as LocalSystem; restarted a minute after a crash.
        string serviceArgs = " binPath= \"\\\"" + serviceExe + "\\\"\" start= auto obj= LocalSystem DisplayName= \"Endpoint IQ Agent\"";
        if (!ServiceExists()) Run("sc.exe", "create " + ServiceName + serviceArgs);
        if (!ServiceExists())
        {
            if (!migrating) StartLegacyTask(installDir);
            return 2;
        }
        Run("sc.exe", "config " + ServiceName + serviceArgs);
        Run("sc.exe", "description " + ServiceName + " \"Applies your organization's Endpoint IQ policies on this PC and reports its status. Managed by your IT team.\"");
        Run("sc.exe", "failure " + ServiceName + " reset= 86400 actions= restart/60000/restart/60000/restart/60000");
        Run("sc.exe", "failureflag " + ServiceName + " 1");

        // 3. The old scheduled task goes before the service starts.
        if (migrating)
        {
            Run("schtasks.exe", "/change /tn " + LegacyTaskName + " /disable");
            Run("schtasks.exe", "/end /tn " + LegacyTaskName);
            Run("schtasks.exe", "/delete /tn " + LegacyTaskName + " /f");
            Thread.Sleep(2000);
        }

        // 4. Start it, and make sure it stays running.
        string startError = null;
        if (ServiceStatus() != ServiceControllerStatus.Running)
        {
            try
            {
                using (ServiceController sc = new ServiceController(ServiceName)) sc.Start();
            }
            catch (Exception ex)
            {
                startError = ex.InnerException != null ? ex.InnerException.Message : ex.Message;
            }
        }
        bool running = false;
        for (int i = 0; i < 10; i++)
        {
            Thread.Sleep(2000);
            if (ServiceStatus() == ServiceControllerStatus.Running) { running = true; break; }
        }
        if (running)
        {
            Thread.Sleep(3000);
            running = ServiceStatus() == ServiceControllerStatus.Running;
        }
        if (running)
        {
            try { File.Delete(blockedMarker); } catch { }
            return 0;
        }

        // Windows wouldn't run it: back to the scheduled task.
        StopService();
        Run("sc.exe", "delete " + ServiceName);
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(blockedMarker));
            string reason = startError ?? "The service didn't stay running.";
            File.WriteAllText(blockedMarker, DateTime.Now.ToString("o") + " " + reason + "\r\n", Encoding.ASCII);
        }
        catch { }
        StartLegacyTask(installDir);
        return 3;
    }

    // The scheduled task the agent ran as before 0.2.23 (same definition), used only as the fallback.
    private static void StartLegacyTask(string installDir)
    {
        if (!LegacyTaskExists())
        {
            string nodeExe = Path.Combine(installDir, @"node\node.exe");
            string entryPoint = Path.Combine(installDir, @"app\dist\index.js");
            string xml =
                "<?xml version=\"1.0\" encoding=\"UTF-16\"?>\r\n" +
                "<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\r\n" +
                "  <Triggers>\r\n" +
                "    <BootTrigger>\r\n" +
                "      <Enabled>true</Enabled>\r\n" +
                "    </BootTrigger>\r\n" +
                "  </Triggers>\r\n" +
                "  <Principals>\r\n" +
                "    <Principal id=\"Author\">\r\n" +
                "      <UserId>S-1-5-18</UserId>\r\n" +
                "      <RunLevel>HighestAvailable</RunLevel>\r\n" +
                "    </Principal>\r\n" +
                "  </Principals>\r\n" +
                "  <Settings>\r\n" +
                "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\r\n" +
                "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>\r\n" +
                "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>\r\n" +
                "    <StartWhenAvailable>true</StartWhenAvailable>\r\n" +
                "    <Hidden>true</Hidden>\r\n" +
                "    <RestartOnFailure>\r\n" +
                "      <Interval>PT1M</Interval>\r\n" +
                "      <Count>999</Count>\r\n" +
                "    </RestartOnFailure>\r\n" +
                "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>\r\n" +
                "  </Settings>\r\n" +
                "  <Actions Context=\"Author\">\r\n" +
                "    <Exec>\r\n" +
                "      <Command>" + nodeExe + "</Command>\r\n" +
                "      <Arguments>\"" + entryPoint + "\"</Arguments>\r\n" +
                "      <WorkingDirectory>" + installDir + "</WorkingDirectory>\r\n" +
                "    </Exec>\r\n" +
                "  </Actions>\r\n" +
                "</Task>\r\n";
            CreateTask(LegacyTaskName, xml);
        }
        Run("schtasks.exe", "/change /tn " + LegacyTaskName + " /enable");
        Run("schtasks.exe", "/run /tn " + LegacyTaskName);
    }

    // schtasks needs the XML as UTF-16 with a BOM (Encoding.Unicode writes one).
    private static int CreateTask(string name, string xml)
    {
        string xmlPath = Path.Combine(Path.GetTempPath(), name + "_" + Guid.NewGuid().ToString("N") + ".xml");
        try
        {
            File.WriteAllText(xmlPath, xml, Encoding.Unicode);
            return Run("schtasks.exe", "/create /tn " + name + " /xml \"" + xmlPath + "\" /f");
        }
        catch
        {
            return -1;
        }
        finally
        {
            try { File.Delete(xmlPath); } catch { }
        }
    }

    private static bool LegacyTaskExists()
    {
        return Run("schtasks.exe", "/query /tn " + LegacyTaskName) == 0;
    }

    private static bool ServiceExists()
    {
        return ServiceStatus() != null;
    }

    private static ServiceControllerStatus? ServiceStatus()
    {
        try
        {
            using (ServiceController sc = new ServiceController(ServiceName)) return sc.Status;
        }
        catch
        {
            return null;
        }
    }

    private static void StopService()
    {
        try
        {
            using (ServiceController sc = new ServiceController(ServiceName))
            {
                if (sc.Status != ServiceControllerStatus.Stopped)
                {
                    sc.Stop();
                    sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
                }
            }
        }
        catch { }
    }

    // Copy-Item -Recurse -Force: merges into an existing folder, overwriting files.
    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (string file in Directory.GetFiles(source))
        {
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
        }
        foreach (string sub in Directory.GetDirectories(source))
        {
            CopyDirectory(sub, Path.Combine(destination, Path.GetFileName(sub)));
        }
    }

    private static string JsonString(string value)
    {
        StringBuilder sb = new StringBuilder("\"");
        foreach (char c in value)
        {
            if (c == '"' || c == '\\') sb.Append('\\').Append(c);
            else if (c < 0x20 || c > 0x7e) sb.Append("\\u").Append(((int)c).ToString("x4"));
            else sb.Append(c);
        }
        return sb.Append('"').ToString();
    }

    // Runs one of Windows' own tools from System32, hidden; returns its exit code (-1 if it
    // couldn't be started).
    private static int Run(string exe, string arguments)
    {
        try
        {
            ProcessStartInfo psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, exe), arguments)
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using (Process proc = Process.Start(psi))
            {
                proc.OutputDataReceived += (s, e) => { };
                proc.ErrorDataReceived += (s, e) => { };
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
                proc.WaitForExit();
                return proc.ExitCode;
            }
        }
        catch
        {
            return -1;
        }
    }
}
