using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Security.Principal;
using System.Windows.Forms;

internal static class SetupStub
{
    [STAThread]
    private static int Main(string[] args)
    {
        bool uninstallMode = args.Length >= 1 && string.Equals(args[0], "/uninstall", StringComparison.OrdinalIgnoreCase);

        WindowsPrincipal principal = new WindowsPrincipal(WindowsIdentity.GetCurrent());
        if (!principal.IsInRole(WindowsBuiltInRole.Administrator))
        {
            string quotedArgs = string.Join(" ", Array.ConvertAll(args, a => "\"" + a + "\""));
            ProcessStartInfo relaunch = new ProcessStartInfo(Assembly.GetExecutingAssembly().Location)
            {
                UseShellExecute = true,
                Verb = "runas",
                Arguments = quotedArgs,
            };
            try
            {
                Process.Start(relaunch);
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                // Covers both "user clicked No" and elevation being blocked outright (e.g. a
                // Group Policy disabling the UAC consent prompt) - previously silent either
                // way, which is indistinguishable from "nothing happened" to whoever ran this.
                MessageBox.Show(
                    "Could not get administrator privileges, so setup did not run.\n\n" + ex.Message,
                    "Endpoint Pro Agent Setup", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            return 0;
        }

        if (uninstallMode)
        {
            DialogResult confirm = MessageBox.Show(
                "This will stop and remove the Endpoint Pro agent from this computer.\n\nContinue?",
                "Endpoint Pro Agent Setup", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (confirm != DialogResult.Yes)
            {
                return 0;
            }

            string uninstallPassword = Microsoft.VisualBasic.Interaction.InputBox(
                "If this deployment has uninstall protection enabled, enter the password. " +
                "Leave blank if none is set.", "Endpoint Pro Agent Setup", "");

            string uninstallArgs = " -UninstallPassword \"" + uninstallPassword.Replace("\"", "`\"") + "\"";
            return RunBundledScript("uninstall.ps1", uninstallArgs, "Uninstall Complete",
                "The Endpoint Pro agent was removed.", "Uninstall Failed", "Uninstall failed:");
        }

        string serverUrl;
        string token;
        string[] embedded = ReadEmbeddedSetupConfig();
        if (args.Length >= 2)
        {
            serverUrl = args[0];
            token = args[1];
        }
        else if (embedded != null)
        {
            // Downloaded from the console - the server appended every address it can be
            // reached on (Server connection details). A per-token copy also carries the token
            // and installs with no prompts; the generic download asks for the token only.
            serverUrl = embedded[0];
            token = embedded[1];
            if (string.IsNullOrWhiteSpace(token))
            {
                token = Microsoft.VisualBasic.Interaction.InputBox(
                    "Enrollment token:", "Endpoint Pro Agent Setup", "").Trim();
                if (string.IsNullOrWhiteSpace(token))
                {
                    MessageBox.Show("An enrollment token is required.", "Endpoint Pro Agent Setup",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    return 1;
                }
            }
        }
        else
        {
            serverUrl = Microsoft.VisualBasic.Interaction.InputBox(
                "Server URL (e.g. http://your-server:4000 - several can be given, comma-separated):", "Endpoint Pro Agent Setup", "");
            if (string.IsNullOrWhiteSpace(serverUrl))
            {
                MessageBox.Show("A server URL is required.", "Endpoint Pro Agent Setup",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }

            token = Microsoft.VisualBasic.Interaction.InputBox(
                "Enrollment token:", "Endpoint Pro Agent Setup", "");
            if (string.IsNullOrWhiteSpace(token))
            {
                MessageBox.Show("An enrollment token is required.", "Endpoint Pro Agent Setup",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }

        string installArgs = " -ServerUrl \"" + serverUrl + "\" -EnrollmentToken \"" + token + "\"";
        return RunBundledScript("install.ps1", installArgs, "Setup Complete",
            "The Endpoint Pro agent was installed successfully and is now running.", "Setup Failed", "Installation failed:");
    }

    // Server-appended trailer: [UTF-8 "url1,url2,...\ntoken"][int32 LE length][16-byte magic]
    // (see agentConnection.service.ts's buildConfiguredSetupExe). Returns {serverUrls, token}
    // - token is "" for the generic download - or null for the plain, unconfigured exe.
    private static readonly byte[] SetupConfigMagic = System.Text.Encoding.ASCII.GetBytes("EPAGENTSETUPCFG1");

    private static string[] ReadEmbeddedSetupConfig()
    {
        try
        {
            // Only the tail - the exe embeds the whole agent, no need to load all of it.
            byte[] self;
            using (FileStream fs = File.OpenRead(Assembly.GetExecutingAssembly().Location))
            {
                int tailLength = (int)Math.Min(fs.Length, 64 * 1024);
                fs.Seek(-tailLength, SeekOrigin.End);
                self = new byte[tailLength];
                int read = 0;
                while (read < tailLength)
                {
                    int n = fs.Read(self, read, tailLength - read);
                    if (n <= 0) return null;
                    read += n;
                }
            }
            int magicStart = self.Length - SetupConfigMagic.Length;
            if (magicStart < 4) return null;
            for (int i = 0; i < SetupConfigMagic.Length; i++)
            {
                if (self[magicStart + i] != SetupConfigMagic[i]) return null;
            }

            int length = BitConverter.ToInt32(self, magicStart - 4);
            int payloadStart = magicStart - 4 - length;
            if (length <= 0 || payloadStart < 0) return null;

            string payload = System.Text.Encoding.UTF8.GetString(self, payloadStart, length);
            string[] parts = payload.Split('\n');
            if (parts.Length != 2 || string.IsNullOrWhiteSpace(parts[0])) return null;
            return new[] { parts[0].Trim(), parts[1].Trim() };
        }
        catch
        {
            return null;
        }
    }

    private static int RunBundledScript(string scriptName, string scriptArgs, string successTitle,
        string successMessage, string failureTitle, string failureLabel)
    {
        string tempDir = Path.Combine(Path.GetTempPath(), "EndpointProSetup_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);

        try
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            string resName = Array.Find(asm.GetManifestResourceNames(),
                n => n.EndsWith("installer.zip", StringComparison.OrdinalIgnoreCase));
            if (resName == null)
            {
                MessageBox.Show("Embedded installer payload not found.", "Endpoint Pro Agent Setup",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

            string zipPath = Path.Combine(tempDir, "installer.zip");
            using (Stream resStream = asm.GetManifestResourceStream(resName))
            using (FileStream fileStream = File.Create(zipPath))
            {
                resStream.CopyTo(fileStream);
            }

            string extractDir = Path.Combine(tempDir, "extracted");
            ZipFile.ExtractToDirectory(zipPath, extractDir);

            string script = Path.Combine(extractDir, scriptName);
            ProcessStartInfo psi = new ProcessStartInfo("powershell.exe",
                "-NoProfile -ExecutionPolicy Bypass -File \"" + script + "\"" + scriptArgs)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            using (Process proc = Process.Start(psi))
            {
                string output = proc.StandardOutput.ReadToEnd();
                string error = proc.StandardError.ReadToEnd();
                proc.WaitForExit();

                if (proc.ExitCode == 0)
                {
                    MessageBox.Show(successMessage, successTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }

                MessageBox.Show(failureLabel + "\n\n" + output + "\n" + error, failureTitle,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
        catch (Exception ex)
        {
            // Anything unexpected here (corrupted/blocked zip extraction, powershell.exe not
            // found, a permissions error writing to %TEMP%, antivirus interference, etc.)
            // previously propagated straight out of Main() with no dialog shown at all -
            // indistinguishable from the tool doing nothing. Whatever actually goes wrong,
            // this guarantees the person running it sees SOME message rather than silence.
            MessageBox.Show(failureLabel + "\n\n" + ex, failureTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try { Directory.Delete(tempDir, true); } catch { }
        }
    }
}
