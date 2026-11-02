import { useEffect, useState, type FormEvent } from "react";
import { CalendarClock, KeyRound, Monitor, PlugZap, Undo2 } from "lucide-react";
import {
  useActivateLicense,
  useLicenseServerConfig,
  useLicenseStatus,
  useMe,
  useModuleVisibility,
  useRequestLicenseUnlock,
  useSetLicenseServerConfig,
  useSetModuleVisibility,
  useTestLicenseServerConnection,
} from "../api/hooks";
import { CHART_SEMANTIC } from "../chartTheme";
import { LICENSE_MODULE_LABELS, NAV_MODULES } from "../navConfig";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  FormFooter,
  FormSection,
  KeyValueList,
  Kpi,
  KpiStrip,
  PageHeader,
  Pill,
  Row,
  Skeleton,
  Switch,
  Tag,
} from "../components/ui";
import { formatDate, formatDateTime } from "../format";

// Pattern C — licensing (design-system/docs/PAGE_PATTERNS.md): forms on the left, read-only
// license facts (.ep-kv) on the right, a usage KPI strip on top.

const VALIDITY_LABELS: Record<string, string> = {
  ONE_YEAR: "1 year",
  TWO_YEAR: "2 years",
  THREE_YEAR: "3 years",
  PERPETUAL: "Perpetual",
};

const MODULE_LABELS = LICENSE_MODULE_LABELS;
const ALL_MODULE_KEYS = Object.keys(MODULE_LABELS);

function LicenseApiPanel() {
  const { data: serverConfig, isLoading } = useLicenseServerConfig();
  const setConfig = useSetLicenseServerConfig();
  const testConnection = useTestLicenseServerConnection();

  const [url, setUrl] = useState("");

  function handleConnect(e: FormEvent) {
    e.preventDefault();
    setConfig.mutate(url, { onSuccess: () => setUrl("") });
  }

  if (isLoading) {
    return (
      <Card title="License server">
        <Skeleton lines={3} />
      </Card>
    );
  }

  const isConnected = !!serverConfig?.configured && serverConfig.lastConnectionOk === true;

  return (
    <form className="ep-card" onSubmit={handleConnect}>
      <FormSection
        title="License server"
        description="Enter the address of the vendor's central License Server. A key can only be activated once a connection to it is confirmed."
      >
        <div className="app-stack">
          {serverConfig?.serverUrl && (
            <KeyValueList
              items={[
                { label: "Configured address", value: serverConfig.serverUrl, mono: true },
                {
                  label: "Connection",
                  value: isConnected ? <Pill tone="ok">Connected</Pill> : <Pill tone="critical">Not connected</Pill>,
                },
                { label: "Last checked", value: formatDateTime(serverConfig.lastConnectionCheckAt) },
              ]}
            />
          )}
          <Field label={serverConfig?.configured ? "Change address" : "License Server address"} htmlFor="license-server-url" required>
            <input
              id="license-server-url"
              className="ep-input ep-mono"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://license.vendor.example"
              required
            />
          </Field>
          {setConfig.isError && <Alert tone="critical">{(setConfig.error as Error).message}</Alert>}
          {testConnection.isError && <Alert tone="critical">{(testConnection.error as Error).message}</Alert>}
        </div>
      </FormSection>
      <FormFooter>
        {serverConfig?.configured && (
          <Button icon={PlugZap} onClick={() => testConnection.mutate()} disabled={testConnection.isPending}>
            {testConnection.isPending ? "Testing…" : "Test connection"}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={setConfig.isPending || !url.trim()}>
          {setConfig.isPending ? "Connecting…" : "Connect"}
        </Button>
      </FormFooter>
    </form>
  );
}

// Org-wide "hide this for everyone" panel — a third, most-authoritative layer on top of
// what the license includes (above) and per-admin grants (Administrators page). Editable
// by SUPER_ADMIN only (server-enforced on the PUT regardless of this UI check), read-only
// note shown to a plain ADMIN instead since they could otherwise hide something out from
// under other admins including super admins.
function ModuleVisibilityPanel() {
  const { data: me } = useMe();
  const { data: visibility, isLoading } = useModuleVisibility();
  const setVisibility = useSetModuleVisibility();

  const [hiddenModuleKeys, setHiddenModuleKeys] = useState<string[]>([]);
  const [hiddenItemPaths, setHiddenItemPaths] = useState<string[]>([]);

  useEffect(() => {
    if (visibility) {
      setHiddenModuleKeys(visibility.hiddenModuleKeys);
      setHiddenItemPaths(visibility.hiddenItemPaths);
    }
  }, [visibility]);

  const hideableModules = NAV_MODULES.filter((m) => m.licenseModule && m.items);

  function toggleModule(key: string) {
    setHiddenModuleKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function toggleItem(path: string) {
    setHiddenItemPaths((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]));
  }

  function handleSave() {
    setVisibility.mutate({ hiddenModuleKeys, hiddenItemPaths });
  }

  if (isLoading) {
    return (
      <Card title="Module visibility">
        <Skeleton lines={3} />
      </Card>
    );
  }

  if (me?.role !== "SUPER_ADMIN") {
    return (
      <Card title="Module visibility">
        <p className="app-text">Only a super admin can hide/unhide modules. Ask one to change this if needed.</p>
      </Card>
    );
  }

  return (
    <Card title="Module visibility" hint="applies to every admin on this deployment">
      <div className="app-settings-form">
        <div className="app-stack">
          <p className="app-text">
            Hide a main module or an individual item within it for <strong>every</strong> admin on this deployment —
            this is stronger than license modules or per-admin access above/in Administrators: a hidden module or item
            disappears from the menu and its page for everyone, including super admins, and (for a whole main module)
            its underlying API is blocked too, not just the menu.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))", gap: 12 }}>
            {hideableModules.map((module) => {
              const moduleHidden = hiddenModuleKeys.includes(module.licenseModule!);
              return (
                <div key={module.key} className="app-inset-form" role="group" aria-label={module.label}>
                  <Switch checked={moduleHidden} onChange={() => toggleModule(module.licenseModule!)} label={`Hide ${module.label} entirely`} />
                  {moduleHidden ? (
                    <span className="app-muted">Every item in {module.label} is hidden.</span>
                  ) : (
                    <div className="app-stack-sm">
                      {module.items!.map((item) => (
                        <Check
                          key={item.path}
                          checked={hiddenItemPaths.includes(item.path)}
                          onChange={() => toggleItem(item.path)}
                          label={`Hide ${item.label}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {setVisibility.isError && <Alert tone="critical">{(setVisibility.error as Error).message}</Alert>}
        </div>
        <FormFooter>
          {setVisibility.isSuccess && !setVisibility.isPending && <span className="app-saved">Saved</span>}
          <Button variant="primary" onClick={handleSave} disabled={setVisibility.isPending}>
            {setVisibility.isPending ? "Saving…" : "Save changes"}
          </Button>
        </FormFooter>
      </div>
    </Card>
  );
}

export default function LicenseActivationPage() {
  const { data: serverConfig } = useLicenseServerConfig();
  const { data: status, isLoading, error: statusError, refetch: refetchStatus } = useLicenseStatus();
  const activate = useActivateLicense();
  const requestUnlock = useRequestLicenseUnlock();

  const [keyString, setKeyString] = useState("");
  const [reason, setReason] = useState("");
  const [unlockSent, setUnlockSent] = useState(false);

  function handleActivate(e: FormEvent) {
    e.preventDefault();
    activate.mutate(keyString, { onSuccess: () => setKeyString("") });
  }

  function handleUnlockRequest(e: FormEvent) {
    e.preventDefault();
    requestUnlock.mutate(reason, {
      onSuccess: () => {
        setUnlockSent(true);
        setReason("");
      },
    });
  }

  const header = (
    <PageHeader
      title="Licensing"
      description="Activate a license key from the vendor's License Server so this deployment can enroll new agents."
    />
  );

  if (isLoading) {
    return (
      <>
        {header}
        <Card>
          <Skeleton />
        </Card>
      </>
    );
  }

  const isExpired = status?.validUntil ? new Date(status.validUntil) < new Date() : false;
  const isRevoked = status?.status === "REVOKED";
  const callbackIssue = status?.callbackRegisteredAt ? null : status?.callbackRegistrationError;
  const atCap = status?.activated && status.maxAgents !== undefined && (status.currentAgentCount ?? 0) >= status.maxAgents;
  const canActivate = !!serverConfig?.configured && serverConfig.lastConnectionOk === true;

  const used = status?.currentAgentCount ?? 0;
  const max = status?.maxAgents ?? 0;
  const usedPct = max > 0 ? Math.round((used / max) * 100) : 0;

  const statusBadge = isRevoked ? (
    <Pill tone="critical">Revoked</Pill>
  ) : isExpired ? (
    <Pill tone="warn">Expired</Pill>
  ) : (
    <Badge tone="ok">Activated</Badge>
  );

  return (
    <>
      {header}

      {!!statusError && (
        <Alert
          tone="critical"
          title="Couldn't load the license status"
          action={
            <Button size="sm" onClick={() => refetchStatus()}>
              Retry
            </Button>
          }
        >
          {(statusError as Error).message}
        </Alert>
      )}

      {status?.activated && (
        <KpiStrip>
          <Kpi
            icon={Monitor}
            label="Agent seats used"
            value={<span className="ep-num">{status.currentAgentCount}</span>}
            valueTone={atCap ? "critical" : undefined}
            suffix={`of ${status.maxAgents} · ${usedPct}%`}
            bar={[
              { value: used, color: atCap ? CHART_SEMANTIC.critical : CHART_SEMANTIC.ok },
              { value: Math.max(max - used, 0), color: CHART_SEMANTIC.neutral },
            ]}
            footer={
              atCap ? (
                <>
                  <Pill tone="critical">At cap</Pill> Paused endpoints still count here — pausing releases policy
                  enforcement, not the seat.
                </>
              ) : (
                "Paused endpoints still count here — pausing releases policy enforcement, not the seat."
              )
            }
          />
          <Kpi
            icon={Undo2}
            label="Total ever uninstalled"
            value={<span className="ep-num">{status.totalAgentsUninstalled ?? 0}</span>}
            suffix="seats released"
            footer="Lifetime count of seats released back by uninstalling — not currently-active usage."
          />
          <Kpi
            icon={CalendarClock}
            label="Valid until"
            value={status.validUntil ? formatDate(status.validUntil) : "Perpetual"}
            valueTone={isExpired ? "warning" : undefined}
            footer={<>Validity: {status.validityType ? VALIDITY_LABELS[status.validityType] : "—"}</>}
          />
        </KpiStrip>
      )}

      <Row layout="21">
        <div className="app-stack">
          <LicenseApiPanel />

          {canActivate ? (
            <form className="ep-card" onSubmit={handleActivate}>
              <FormSection
                title={status?.activated ? "Activate a replacement key" : "Activate a license key"}
                description="Activation is one-time-use — once a key is redeemed here, it locks to this deployment."
              >
                <div className="app-stack">
                  <Field label="License key" htmlFor="license-key" required>
                    <input
                      id="license-key"
                      className="ep-input ep-mono"
                      type="text"
                      value={keyString}
                      onChange={(e) => setKeyString(e.target.value)}
                      placeholder="XXXX-XXXX-XXXX-XXXX-XXXX"
                      required
                    />
                  </Field>
                  {activate.isError && <Alert tone="critical">{(activate.error as Error).message}</Alert>}
                  {activate.isSuccess && <Alert tone="success">License activated.</Alert>}
                </div>
              </FormSection>
              <FormFooter>
                <Button type="submit" variant="primary" icon={KeyRound} disabled={activate.isPending || !keyString.trim()}>
                  {activate.isPending ? "Activating…" : "Activate"}
                </Button>
              </FormFooter>
            </form>
          ) : (
            <Card title="Activate a license key">
              <EmptyState icon={PlugZap} title="Not connected to the License Server">
                Connect to the License Server above first.
              </EmptyState>
            </Card>
          )}

          {status?.activated && (
            <form className="ep-card" onSubmit={handleUnlockRequest}>
              <FormSection
                title="Request an unlock"
                description="If this deployment is being migrated to new hardware, or the license needs to be re-activated for any other reason, send an unlock request to the vendor. A vendor admin reviews and approves it manually before the key can be activated again."
              >
                <div className="app-stack">
                  <Field label="Reason" htmlFor="unlock-reason" required>
                    <input
                      id="unlock-reason"
                      className="ep-input"
                      type="text"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. Migrating to new hardware"
                      required
                    />
                  </Field>
                  {requestUnlock.isError && <Alert tone="critical">{(requestUnlock.error as Error).message}</Alert>}
                  {unlockSent && !requestUnlock.isError && <Alert tone="success">Unlock request sent — awaiting vendor approval.</Alert>}
                </div>
              </FormSection>
              <FormFooter>
                <Button type="submit" disabled={requestUnlock.isPending || !reason.trim()}>
                  {requestUnlock.isPending ? "Sending…" : "Send unlock request"}
                </Button>
              </FormFooter>
            </form>
          )}
        </div>

        <div className="app-stack">
          {status?.activated ? (
            <Card title="License" actions={statusBadge}>
              <div className="app-stack">
                <KeyValueList
                  items={[
                    { label: "Entity", value: status.entityName },
                    { label: "Status", value: statusBadge },
                    {
                      label: "Agents",
                      value: (
                        <span className="app-badge-row">
                          <span className="ep-num">
                            {status.currentAgentCount} / {status.maxAgents}
                          </span>
                          {atCap && <Pill tone="critical">At cap</Pill>}
                        </span>
                      ),
                    },
                    { label: "Total ever uninstalled", value: <span className="ep-num">{status.totalAgentsUninstalled ?? 0}</span> },
                    { label: "Validity", value: status.validityType ? VALIDITY_LABELS[status.validityType] : "—" },
                    {
                      label: "Modules",
                      value:
                        !status.modules || status.modules.length === ALL_MODULE_KEYS.length ? (
                          "All"
                        ) : status.modules.length === 0 ? (
                          "None"
                        ) : (
                          <span className="app-badge-row">
                            {status.modules.map((m) => (
                              <Tag key={m}>{MODULE_LABELS[m] ?? m}</Tag>
                            ))}
                          </span>
                        ),
                    },
                    { label: "Valid until", value: status.validUntil ? formatDate(status.validUntil) : "Perpetual" },
                    { label: "Deployment ID", value: status.deploymentId, mono: true },
                    {
                      label: "Revoke notices",
                      value: status.callbackRegisteredAt
                        ? `Registered ${formatDateTime(status.callbackRegisteredAt, "")}`
                        : "Not registered yet",
                    },
                  ]}
                />
                {callbackIssue && !isRevoked && (
                  <Alert tone="warn" title="Couldn't register with the License Server">
                    {callbackIssue}. The license stays active; this deployment retries every hour.
                  </Alert>
                )}
              </div>
            </Card>
          ) : (
            <Card title="License" actions={<Badge tone="neu">Not activated</Badge>}>
              <EmptyState icon={KeyRound} title="Not activated">
                No license key has been activated on this deployment yet. New agent enrollment is blocked until one is.
              </EmptyState>
            </Card>
          )}
          <Alert tone="info">
            This deployment must activate a license key (issued by the vendor's central License Server) before it can
            enroll new agents. Activation is one-time-use — once a key is redeemed here, it locks to this deployment.
            After that the license stays active even if the License Server is offline.
          </Alert>
        </div>
      </Row>

      <ModuleVisibilityPanel />
    </>
  );
}
