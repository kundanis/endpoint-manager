// Endpoint user consent (DPDP) in the tray app: shows the organisation's notice to the signed-in
// user and records their answer (I agree / Decline) through the local agent (GET/POST /consent,
// see consent.ts). Until every signed-in user has agreed, the agent sends no monitoring data.
//
// It never opens by itself: the user opens it from the tray icon's menu (Privacy consent) or by
// clicking the icon, any time, to read the notice or change their answer.
//
// Compiled with TrayApp.cs by package-installer.ps1 (.NET Framework csc: C# 5, no newer syntax).
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Threading;
using System.Windows.Forms;

class ConsentForm : Form
{
    readonly Label heading = new Label();
    readonly TextBox notice = new TextBox();
    readonly CheckBox agree = new CheckBox();
    readonly Button save = new Button();
    readonly Button decline = new Button();
    readonly Label message = new Label();
    readonly Action<string> answered;
    int version;

    public ConsentForm(Icon appIcon, Action<string> answered)
    {
        this.answered = answered;
        Text = "Endpoint IQ – Privacy consent";
        Icon = appIcon;
        Font = new Font("Segoe UI", 9.5f);
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(560, 520);
        Size = new Size(720, 680);
        TopMost = true;

        TableLayoutPanel layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 1, RowCount = 5 };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        Controls.Add(layout);

        heading.AutoSize = true;
        heading.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
        heading.Margin = new Padding(0, 0, 0, 10);
        heading.Text = "Loading…";
        layout.Controls.Add(heading);

        notice.Multiline = true;
        notice.ReadOnly = true;
        notice.ScrollBars = ScrollBars.Vertical;
        notice.Dock = DockStyle.Fill;
        notice.BackColor = SystemColors.Window;
        layout.Controls.Add(notice);

        agree.AutoSize = true;
        agree.Margin = new Padding(0, 12, 0, 4);
        agree.Text = "I have read this notice and I agree to the processing of my personal data as described.";
        agree.CheckedChanged += (s, e) => save.Enabled = agree.Checked && version > 0;
        layout.Controls.Add(agree);

        FlowLayoutPanel actions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, FlowDirection = FlowDirection.LeftToRight, Margin = new Padding(0, 8, 0, 0) };
        save.Text = "Save";
        save.AutoSize = true;
        save.Enabled = false;
        save.Click += (s, e) => Send("AGREED");
        decline.Text = "Decline";
        decline.AutoSize = true;
        decline.Enabled = false;
        decline.Click += (s, e) =>
        {
            if (MessageBox.Show(this,
                "If you decline, this computer won't send monitoring data about you. Your organisation's security policies (for example blocked websites or programs) still apply, and your IT administrator will see that you declined.\n\nDecline?",
                "Decline consent", MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes) Send("DECLINED");
        };
        actions.Controls.Add(save);
        actions.Controls.Add(decline);
        layout.Controls.Add(actions);

        message.AutoSize = true;
        message.Margin = new Padding(0, 8, 0, 0);
        message.MaximumSize = new Size(660, 0);
        layout.Controls.Add(message);

        Load += (s, e) => Reload();
    }

    void Reload()
    {
        ThreadPool.QueueUserWorkItem(_ =>
        {
            object c = null;
            string error = null;
            try
            {
                c = AgentApi.Call("GET", "/consent", null);
            }
            catch (Exception e)
            {
                error = e.Message;
            }
            OnUi(() => Display(c, error));
        });
    }

    void Display(object c, string error)
    {
        if (error != null)
        {
            heading.Text = "Privacy consent";
            message.Text = error;
            return;
        }
        if (AgentApi.Str(c, "required") != "True")
        {
            heading.Text = "Privacy consent";
            notice.Text = "Your organisation doesn't ask for consent on this computer.";
            version = 0;
            save.Enabled = decline.Enabled = agree.Enabled = false;
            return;
        }
        int.TryParse(AgentApi.Str(c, "version"), out version);
        heading.Text = AgentApi.Str(c, "title") ?? "Privacy consent";
        string body = (AgentApi.Str(c, "body") ?? "").Replace("\r\n", "\n").Replace("\n", "\r\n");
        string contact = AgentApi.Str(c, "grievanceContact");
        if (!string.IsNullOrEmpty(contact)) body += "\r\n\r\nGrievance contact: " + contact;
        notice.Text = body;
        notice.SelectionStart = 0;
        string decision = AgentApi.Str(c, "decision");
        agree.Enabled = true;
        decline.Enabled = true;
        agree.Checked = decision == "AGREED";
        save.Enabled = agree.Checked;
        message.Text = decision == "AGREED"
            ? "You agreed to this notice. To withdraw your consent, select Decline."
            : decision == "DECLINED"
                ? "You declined this notice. To agree instead, tick the box and select Save."
                : "Please read the notice, tick the box and select Save - or select Decline.";
    }

    void Send(string decision)
    {
        save.Enabled = decline.Enabled = false;
        message.Text = "Saving…";
        int v = version;
        ThreadPool.QueueUserWorkItem(_ =>
        {
            string error = null;
            try
            {
                Dictionary<string, object> body = new Dictionary<string, object>();
                body["decision"] = decision;
                body["version"] = v;
                AgentApi.Call("POST", "/consent", body);
            }
            catch (Exception e)
            {
                error = e.Message;
            }
            OnUi(() =>
            {
                if (error != null)
                {
                    message.Text = error;
                    save.Enabled = agree.Checked;
                    decline.Enabled = true;
                    return;
                }
                answered(decision);
                Close();
            });
        });
    }

    // Runs on the window's thread - unless it was closed meanwhile (then there's nothing to update).
    void OnUi(Action action)
    {
        try
        {
            if (IsDisposed || !IsHandleCreated) return;
            BeginInvoke((Action)(() =>
            {
                try
                {
                    if (!IsDisposed) action();
                }
                catch (Exception e)
                {
                    TrayLog.Write("Consent window: " + e);
                }
            }));
        }
        catch (InvalidOperationException)
        {
            // closed while the reply was on its way
        }
    }
}
