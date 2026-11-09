// Endpoint IQ tray app (tray\EndpointIQTray.exe). Started in each signed-in user's session by the
// EndpointIQAgent service and runs as that user. Shows the agent's status in the notification
// area and lets the user see the EPM and DLP policies on this PC and ask an administrator to
// pause some of them for a while.
//
// It talks only to the agent on this PC (127.0.0.1, see localApi.ts); the agent passes requests
// on to the server. Closing it changes nothing about protection - the service keeps enforcing.
//
// Compiled by package-installer.ps1 with the .NET Framework's own C# compiler.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

static class Program
{
    // "EndpointIQTray.exe /policies" opens the policies window straight away.
    [STAThread]
    static void Main(string[] args)
    {
        bool created;
        using (Mutex mutex = new Mutex(true, @"Local\EndpointIQTray", out created))
        {
            if (!created) return; // already running in this session
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            TrayContext context = new TrayContext();
            if (Array.Exists(args, a => a.Equals("/policies", StringComparison.OrdinalIgnoreCase))) context.ShowPolicies();
            Application.Run(context);
        }
    }
}

// ---- Talking to the local agent -------------------------------------------------------------

static class AgentApi
{
    const string BaseUrl = "http://127.0.0.1:47613";
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

    public static object Call(string method, string path, object body)
    {
        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(BaseUrl + path);
        req.Method = method;
        req.Timeout = 20000;
        req.Proxy = null;
        req.Headers["X-Endpoint-IQ-Tray"] = "1";
        if (body != null)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(body));
            req.ContentType = "application/json";
            req.ContentLength = bytes.Length;
            using (Stream s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
        }
        try
        {
            using (HttpWebResponse res = (HttpWebResponse)req.GetResponse())
                return Parse(res);
        }
        catch (WebException e)
        {
            HttpWebResponse res = e.Response as HttpWebResponse;
            if (res == null) throw new ApplicationException("The Endpoint IQ agent isn't responding on this PC.");
            Dictionary<string, object> err = Parse(res) as Dictionary<string, object>;
            throw new ApplicationException(err != null && err.ContainsKey("error") ? Convert.ToString(err["error"]) : e.Message);
        }
    }

    static object Parse(HttpWebResponse res)
    {
        using (StreamReader r = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
        {
            string text = r.ReadToEnd();
            return string.IsNullOrEmpty(text) ? null : Json.DeserializeObject(text);
        }
    }

    public static string Str(object row, string key)
    {
        Dictionary<string, object> d = row as Dictionary<string, object>;
        return d != null && d.ContainsKey(key) && d[key] != null ? Convert.ToString(d[key]) : null;
    }

    public static IEnumerable<object> List(object value)
    {
        IEnumerable list = value as IEnumerable;
        if (list == null || value is string) yield break;
        foreach (object o in list) yield return o;
    }

    public static string When(string iso)
    {
        DateTime t;
        if (string.IsNullOrEmpty(iso) || !DateTime.TryParse(iso, null, System.Globalization.DateTimeStyles.RoundtripKind, out t)) return "";
        t = t.ToLocalTime();
        return t.Date == DateTime.Today ? t.ToString("HH:mm") : t.ToString("d MMM HH:mm");
    }

    public static string Duration(int minutes)
    {
        if (minutes < 60) return minutes + " minutes";
        if (minutes < 1440) return (minutes / 60) + (minutes == 60 ? " hour" : " hours");
        return (minutes / 1440) + (minutes == 1440 ? " day" : " days");
    }
}

// ---- Notification area icon -----------------------------------------------------------------

class TrayContext : ApplicationContext
{
    readonly NotifyIcon icon = new NotifyIcon();
    readonly Icon baseIcon;
    readonly ToolStripMenuItem statusItem = new ToolStripMenuItem("Checking…") { Enabled = false };
    readonly ToolStripMenuItem syncItem = new ToolStripMenuItem("Last sync: –") { Enabled = false };
    readonly System.Windows.Forms.Timer statusTimer = new System.Windows.Forms.Timer { Interval = 15000 };
    readonly System.Windows.Forms.Timer requestTimer = new System.Windows.Forms.Timer { Interval = 60000 };
    readonly Dictionary<string, string> knownStatus = new Dictionary<string, string>();
    readonly SynchronizationContext ui;
    PoliciesForm policiesForm;
    string version = "", hostname = "", server = "";
    int lastState = -1; // 0 offline, 1 connected, 2 agent not running

    public TrayContext()
    {
        ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        baseIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        ContextMenuStrip menu = new ContextMenuStrip();
        menu.Items.Add(statusItem);
        menu.Items.Add(syncItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("Sync now", null, (s, e) => SyncNow()));
        ToolStripMenuItem policies = new ToolStripMenuItem("Policies and pause requests…", null, (s, e) => ShowPolicies());
        policies.Font = new Font(policies.Font, FontStyle.Bold);
        menu.Items.Add(policies);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(new ToolStripMenuItem("About Endpoint IQ", null, (s, e) => ShowAbout()));

        icon.ContextMenuStrip = menu;
        icon.Icon = baseIcon;
        icon.Text = "Endpoint IQ Agent";
        icon.Visible = true;
        icon.DoubleClick += (s, e) => ShowPolicies();

        statusTimer.Tick += (s, e) => RefreshStatus();
        requestTimer.Tick += (s, e) => CheckRequests(false);
        statusTimer.Start();
        requestTimer.Start();
        RefreshStatus();
        CheckRequests(true);

        UsageTracker usage = new UsageTracker();
        Application.ApplicationExit += (s, e) => usage.Flush();
        Microsoft.Win32.SystemEvents.SessionEnding += (s, e) => usage.Flush();
    }

    void Background(Action work)
    {
        ThreadPool.QueueUserWorkItem(_ => work());
    }

    void OnUi(Action action)
    {
        ui.Post(_ => action(), null);
    }

    void RefreshStatus()
    {
        Background(() =>
        {
            int state;
            string last = "";
            try
            {
                object s = AgentApi.Call("GET", "/status", null);
                version = AgentApi.Str(s, "version") ?? "";
                hostname = AgentApi.Str(s, "hostname") ?? "";
                server = AgentApi.Str(s, "serverUrl") ?? "";
                last = AgentApi.When(AgentApi.Str(s, "lastCheckinAt"));
                state = AgentApi.Str(s, "connected") == "True" ? 1 : 0;
            }
            catch
            {
                state = 2;
            }
            OnUi(() => ShowState(state, last));
        });
    }

    void ShowState(int state, string last)
    {
        statusItem.Text = state == 1 ? "Connected to Endpoint IQ" : state == 0 ? "Can't reach the Endpoint IQ server" : "Endpoint IQ agent isn't running";
        syncItem.Text = "Last sync: " + (last == "" ? "–" : last) + (version != "" ? "   ·   v" + version : "");
        string tip = "Endpoint IQ Agent – " + (state == 1 ? "connected" : state == 0 ? "offline" : "not running");
        icon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
        if (state != lastState)
        {
            icon.Icon = state == 1 ? baseIcon : WithDot(state == 0 ? Color.FromArgb(128, 128, 128) : Color.FromArgb(196, 43, 28));
            lastState = state;
        }
    }

    // The logo with a small status dot in the corner (grey: offline, red: agent not running).
    Icon WithDot(Color color)
    {
        Size size = SystemInformation.SmallIconSize;
        using (Bitmap bmp = new Bitmap(size.Width, size.Height))
        {
            using (Graphics g = Graphics.FromImage(bmp))
            {
                g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                g.DrawIcon(new Icon(baseIcon, size), new Rectangle(Point.Empty, size));
                int d = size.Width / 2;
                Rectangle dot = new Rectangle(size.Width - d, size.Height - d, d - 1, d - 1);
                using (Brush b = new SolidBrush(color)) g.FillEllipse(b, dot);
                using (Pen p = new Pen(Color.White, 1)) g.DrawEllipse(p, dot);
            }
            return Icon.FromHandle(bmp.GetHicon());
        }
    }

    void SyncNow()
    {
        Background(() =>
        {
            string message;
            try
            {
                object r = AgentApi.Call("POST", "/sync", null);
                message = AgentApi.Str(r, "started") == "True"
                    ? "Syncing with the Endpoint IQ server. Policy changes apply within a minute."
                    : "A sync was started less than 30 seconds ago.";
            }
            catch (Exception e)
            {
                message = e.Message;
            }
            OnUi(() => icon.ShowBalloonTip(5000, "Endpoint IQ", message, ToolTipIcon.Info));
            Thread.Sleep(5000);
            RefreshStatus();
        });
    }

    // Tells the user when an administrator answers one of their requests.
    void CheckRequests(bool firstRun)
    {
        Background(() =>
        {
            List<string> news = new List<string>();
            try
            {
                foreach (object r in AgentApi.List(AgentApi.Call("GET", "/pause-requests", null)))
                {
                    string id = AgentApi.Str(r, "id");
                    string status = AgentApi.Str(r, "status");
                    string before;
                    bool seen = knownStatus.TryGetValue(id, out before);
                    knownStatus[id] = status;
                    if (firstRun || !seen || before != "PENDING" || status == "PENDING") continue;
                    string name = AgentApi.Str(r, "policyName");
                    if (status == "APPROVED")
                        news.Add("Approved: \"" + name + "\" is paused until " + AgentApi.When(AgentApi.Str(r, "expiresAt")) + ".");
                    else if (status == "REJECTED")
                    {
                        string note = AgentApi.Str(r, "resolutionNote");
                        news.Add("Not approved: \"" + name + "\"" + (string.IsNullOrEmpty(note) ? "." : " – " + note));
                    }
                }
            }
            catch
            {
                return;
            }
            if (news.Count > 0)
            {
                OnUi(() =>
                {
                    icon.ShowBalloonTip(10000, "Pause request answered", string.Join("\n", news.ToArray()), ToolTipIcon.Info);
                    if (policiesForm != null && !policiesForm.IsDisposed) policiesForm.Reload();
                });
            }
        });
    }

    public void ShowPolicies()
    {
        if (policiesForm == null || policiesForm.IsDisposed) policiesForm = new PoliciesForm(baseIcon);
        policiesForm.Show();
        if (policiesForm.WindowState == FormWindowState.Minimized) policiesForm.WindowState = FormWindowState.Normal;
        policiesForm.Activate();
    }

    void ShowAbout()
    {
        MessageBox.Show(
            "Endpoint IQ Agent" + (version != "" ? " " + version : "") + "\n\n" +
            "This PC" + (hostname != "" ? " (" + hostname + ")" : "") + " is managed by your organization's IT team.\n" +
            (server != "" ? "Server: " + server + "\n" : "") +
            "\nThe agent runs as a Windows service, so closing this icon doesn't change any protection.",
            "About Endpoint IQ", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }
}

// ---- Policies and pause requests window -----------------------------------------------------

class PoliciesForm : Form
{
    readonly ListView policies = new ListView();
    readonly ListView requests = new ListView();
    readonly ComboBox duration = new ComboBox();
    readonly TextBox reason = new TextBox();
    readonly Button submit = new Button();
    readonly Label message = new Label();
    readonly int[] durations = { 15, 60, 240, 480, 1440 };
    bool loading;

    public PoliciesForm(Icon appIcon)
    {
        Text = "Endpoint IQ – Policies on this PC";
        Icon = appIcon;
        Font = new Font("Segoe UI", 9f);
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(640, 560);
        Size = new Size(760, 640);

        TableLayoutPanel layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(16), ColumnCount = 1, RowCount = 8 };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 55));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 45));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        Controls.Add(layout);

        layout.Controls.Add(Heading("Policies on this PC",
            "Tick the policies you need paused, choose for how long and say why. Your IT administrator approves or rejects the request; you'll get a notification either way."));

        policies.View = View.Details;
        policies.CheckBoxes = true;
        policies.FullRowSelect = true;
        policies.Dock = DockStyle.Fill;
        policies.Columns.Add("Policy", 250);
        policies.Columns.Add("Area", 60);
        policies.Columns.Add("Type", 150);
        policies.Columns.Add("Status", 200);
        policies.ItemCheck += (s, e) =>
        {
            // Policies already paused or waiting for an answer can't be asked for again.
            if (!loading && e.NewValue == CheckState.Checked && policies.Items[e.Index].Tag == null) e.NewValue = CheckState.Unchecked;
        };
        layout.Controls.Add(policies);

        FlowLayoutPanel form = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, Margin = new Padding(0, 10, 0, 0) };
        form.Controls.Add(new Label { Text = "Pause for", AutoSize = true, Margin = new Padding(0, 7, 6, 0) });
        duration.DropDownStyle = ComboBoxStyle.DropDownList;
        duration.Width = 120;
        foreach (int m in durations) duration.Items.Add(AgentApi.Duration(m));
        duration.SelectedIndex = 1;
        form.Controls.Add(duration);
        layout.Controls.Add(form);

        layout.Controls.Add(new Label { Text = "Reason (required)", AutoSize = true, Margin = new Padding(0, 10, 0, 4) });
        reason.Multiline = true;
        reason.Height = 54;
        reason.Dock = DockStyle.Fill;
        reason.MaxLength = 1000;
        layout.Controls.Add(reason);

        FlowLayoutPanel actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, Margin = new Padding(0, 8, 0, 8) };
        submit.Text = "Request pause";
        submit.AutoSize = true;
        submit.Click += (s, e) => Submit();
        Button refresh = new Button { Text = "Refresh", AutoSize = true };
        refresh.Click += (s, e) => Reload();
        message.AutoSize = true;
        message.Margin = new Padding(10, 7, 0, 0);
        actions.Controls.Add(submit);
        actions.Controls.Add(refresh);
        actions.Controls.Add(message);
        layout.Controls.Add(actions);

        requests.View = View.Details;
        requests.FullRowSelect = true;
        requests.Dock = DockStyle.Fill;
        requests.Columns.Add("Your requests", 220);
        requests.Columns.Add("Asked", 90);
        requests.Columns.Add("For", 80);
        requests.Columns.Add("Status", 170);
        requests.Columns.Add("Note", 160);
        layout.Controls.Add(requests);

        layout.Controls.Add(new Label
        {
            Text = "Pauses end by themselves when the time is up. An administrator can also end one early.",
            AutoSize = true,
            ForeColor = SystemColors.GrayText,
            Margin = new Padding(0, 8, 0, 0),
        });

        AcceptButton = submit;
        Shown += (s, e) => Reload();
        FormClosing += (s, e) =>
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true; // keep the window for next time, just hide it
                Hide();
            }
        };
    }

    static Control Heading(string title, string text)
    {
        FlowLayoutPanel panel = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, Margin = new Padding(0, 0, 0, 10) };
        panel.Controls.Add(new Label { Text = title, AutoSize = true, Font = new Font("Segoe UI Semibold", 12f) });
        panel.Controls.Add(new Label { Text = text, AutoSize = true, MaximumSize = new Size(700, 0), Margin = new Padding(0, 4, 0, 0) });
        return panel;
    }

    void Status(string text, bool error)
    {
        message.Text = text;
        message.ForeColor = error ? Color.FromArgb(179, 38, 30) : SystemColors.ControlText;
    }

    public void Reload()
    {
        Status("Loading…", false);
        ThreadPool.QueueUserWorkItem(_ =>
        {
            object list = null, mine = null;
            string error = null;
            try
            {
                list = AgentApi.Call("GET", "/policies", null);
                mine = AgentApi.Call("GET", "/pause-requests", null);
            }
            catch (Exception e)
            {
                error = e.Message;
            }
            if (IsDisposed) return;
            BeginInvoke((Action)(() => Fill(list, mine, error)));
        });
    }

    void Fill(object list, object mine, string error)
    {
        if (error != null)
        {
            Status(error, true);
            return;
        }

        loading = true;
        policies.BeginUpdate();
        policies.Items.Clear();
        foreach (object p in AgentApi.List(list))
        {
            string pausedUntil = AgentApi.Str(p, "pausedUntil");
            bool pending = AgentApi.Str(p, "pendingRequestId") != null;
            ListViewItem item = new ListViewItem(AgentApi.Str(p, "name"));
            item.SubItems.Add(AgentApi.Str(p, "area"));
            item.SubItems.Add(AgentApi.Str(p, "typeLabel"));
            item.SubItems.Add(pausedUntil != null ? "Paused until " + AgentApi.When(pausedUntil) : pending ? "Waiting for approval" : "Active");
            if (pausedUntil == null && !pending)
                item.Tag = new KeyValuePair<string, string>(AgentApi.Str(p, "policyType"), AgentApi.Str(p, "policyId"));
            else
                item.ForeColor = SystemColors.GrayText;
            policies.Items.Add(item);
        }
        if (policies.Items.Count == 0)
            policies.Items.Add(new ListViewItem("No EPM or DLP policies apply to this PC.") { ForeColor = SystemColors.GrayText });
        policies.EndUpdate();
        loading = false;

        requests.BeginUpdate();
        requests.Items.Clear();
        foreach (object r in AgentApi.List(mine))
        {
            string status = AgentApi.Str(r, "status");
            bool active = AgentApi.Str(r, "isActive") == "True";
            string shown =
                status == "PENDING" ? "Waiting for approval" :
                status == "REJECTED" ? "Not approved" :
                status == "ENDED" ? "Ended early by IT" :
                active ? "Approved – until " + AgentApi.When(AgentApi.Str(r, "expiresAt")) : "Approved – ended";
            int minutes;
            int.TryParse(AgentApi.Str(r, "durationMinutes"), out minutes);
            ListViewItem item = new ListViewItem(AgentApi.Str(r, "policyName"));
            item.SubItems.Add(AgentApi.When(AgentApi.Str(r, "createdAt")));
            item.SubItems.Add(AgentApi.Duration(minutes));
            item.SubItems.Add(shown);
            item.SubItems.Add(AgentApi.Str(r, "resolutionNote") ?? "");
            requests.Items.Add(item);
        }
        if (requests.Items.Count == 0)
            requests.Items.Add(new ListViewItem("No requests yet.") { ForeColor = SystemColors.GrayText });
        requests.EndUpdate();
        Status("", false);
    }

    void Submit()
    {
        List<object> items = new List<object>();
        foreach (ListViewItem item in policies.CheckedItems)
        {
            if (!(item.Tag is KeyValuePair<string, string>)) continue;
            KeyValuePair<string, string> key = (KeyValuePair<string, string>)item.Tag;
            items.Add(new Dictionary<string, object> { { "policyType", key.Key }, { "policyId", key.Value } });
        }
        if (items.Count == 0)
        {
            Status("Tick at least one policy first.", true);
            return;
        }
        if (reason.Text.Trim().Length == 0)
        {
            Status("Please say why you need the pause.", true);
            reason.Focus();
            return;
        }

        Dictionary<string, object> body = new Dictionary<string, object>
        {
            { "items", items },
            { "durationMinutes", durations[duration.SelectedIndex] },
            { "reason", reason.Text.Trim() },
            { "requestedBy", Environment.UserDomainName + "\\" + Environment.UserName },
        };
        submit.Enabled = false;
        Status("Sending…", false);
        ThreadPool.QueueUserWorkItem(_ =>
        {
            string error = null;
            try
            {
                AgentApi.Call("POST", "/pause-requests", body);
            }
            catch (Exception e)
            {
                error = e.Message;
            }
            if (IsDisposed) return;
            BeginInvoke((Action)(() =>
            {
                submit.Enabled = true;
                if (error != null)
                {
                    Status(error, true);
                    return;
                }
                reason.Text = "";
                Reload();
                MessageBox.Show(this, "Your request was sent to your IT administrator. You'll get a notification when they answer.",
                    "Request sent", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }));
        });
    }
}
