// Templated rather than a static file so whoever downloads/registers this manifest gets one
// pointing at wherever they actually fetched it from — no manual find-and-replace of a
// hostname across half a dozen URLs. See routes/emailAddin.routes.ts's manifest route.
//
// This Id must stay constant for the lifetime of this deployment's add-in registration —
// Microsoft 365 treats a changed Id as a different app, not an update to this one.
const ADDIN_ID = "784bc35f-6464-4b3e-87f0-419ccf25bd5e";

export function renderEmailAddinManifest(baseUrl: string): string {
  const b = baseUrl.replace(/\/$/, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
           xmlns:mailappor="http://schemas.microsoft.com/office/mailappversionoverrides"
           xsi:type="MailApp">
  <Id>${ADDIN_ID}</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Endpoint Manager</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="Endpoint Manager - PII Attachment Guard" />
  <Description DefaultValue="Scans outgoing email attachments for personal data (credit card numbers, national IDs, etc.) and blocks the send if a match is found. Scanning happens entirely on this device; attachment content is never sent anywhere." />
  <IconUrl DefaultValue="${b}/outlook-addin/icon-32.png" />
  <HighResolutionIconUrl DefaultValue="${b}/outlook-addin/icon-80.png" />
  <SupportUrl DefaultValue="${b}/" />
  <AppDomains>
    <AppDomain>${b}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Mailbox" />
  </Hosts>
  <Requirements>
    <Sets>
      <Set Name="Mailbox" MinVersion="1.14" />
    </Sets>
  </Requirements>
  <FormSettings>
    <Form xsi:type="ItemEdit">
      <DesktopSettings>
        <SourceLocation DefaultValue="${b}/outlook-addin/commands.html" />
      </DesktopSettings>
    </Form>
  </FormSettings>
  <Permissions>ReadWriteItem</Permissions>
  <Rule xsi:type="RuleCollection" Mode="Or">
    <Rule xsi:type="ItemIs" ItemType="Message" FormType="Edit" />
  </Rule>
  <DisableEntityHighlighting>false</DisableEntityHighlighting>
  <!-- Event-based activation (Runtimes / LaunchEvent) is only valid inside a
       VersionOverridesV1_1 nested in the V1_0 wrapper; Microsoft 365 rejects a manifest that
       puts <Runtimes> directly under V1_0. -->
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides" xsi:type="VersionOverridesV1_0">
    <VersionOverrides xmlns="http://schemas.microsoft.com/office/mailappversionoverrides/1.1" xsi:type="VersionOverridesV1_1">
      <Requirements>
        <bt:Sets DefaultMinVersion="1.14">
          <bt:Set Name="Mailbox" />
        </bt:Sets>
      </Requirements>
      <Hosts>
        <Host xsi:type="MailHost">
          <Runtimes>
            <!-- Outlook on the web and new Outlook load the HTML page; classic Outlook on
                 Windows only loads the JavaScript file named by the override. -->
            <Runtime resid="Runtime.Url">
              <Override type="javascript" resid="JSRuntime.Url" />
            </Runtime>
          </Runtimes>
          <DesktopFormFactor>
            <FunctionFile resid="Runtime.Url" />
            <ExtensionPoint xsi:type="LaunchEvent">
              <LaunchEvents>
                <!-- SoftBlock (Mailbox 1.14): a match blocks the send outright, but if the
                     add-in itself is unavailable the user can still send — the fail-open
                     behavior docs/email-attachment-blocking.md promises. PromptUser would
                     instead offer "Send Anyway" on every match. -->
                <LaunchEvent Type="OnMessageSend" FunctionName="onMessageSendHandler" SendMode="SoftBlock" />
              </LaunchEvents>
              <SourceLocation resid="Runtime.Url" />
            </ExtensionPoint>
          </DesktopFormFactor>
        </Host>
      </Hosts>
      <Resources>
        <bt:Images>
          <bt:Image id="Icon.16x16" DefaultValue="${b}/outlook-addin/icon-16.png" />
          <bt:Image id="Icon.32x32" DefaultValue="${b}/outlook-addin/icon-32.png" />
          <bt:Image id="Icon.80x80" DefaultValue="${b}/outlook-addin/icon-80.png" />
        </bt:Images>
        <bt:Urls>
          <bt:Url id="Runtime.Url" DefaultValue="${b}/outlook-addin/commands.html" />
          <bt:Url id="JSRuntime.Url" DefaultValue="${b}/outlook-addin/commands.js" />
        </bt:Urls>
      </Resources>
    </VersionOverrides>
  </VersionOverrides>
</OfficeApp>
`;
}
