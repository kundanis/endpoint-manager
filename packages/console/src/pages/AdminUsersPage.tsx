import { useState, type CSSProperties, type FormEvent } from "react";
import { KeyRound, Pencil, Trash2, UserPlus, Users } from "lucide-react";
import type { AdminActiveSession, AdminGrantKey, AdminRole, AdminUserListItem, LicenseModuleKey } from "../api/types";
import { useAdminUsers, useCreateAdminUser, useDeleteAdminUser, useMe, useUpdateAdminUser } from "../api/hooks";
import { LICENSE_MODULE_LABELS } from "../navConfig";
import {
  Alert,
  Badge,
  Button,
  Card,
  Check,
  EmptyState,
  Field,
  FormGrid,
  FormSection,
  Modal,
  PageHeader,
  Pagination,
  RowMenu,
  Skeleton,
  Tag,
  useConfirm,
  usePagedList,
  usePrompt,
} from "../components/ui";
import { formatDate, formatDateTime, formatRelative } from "../format";

// Pattern B (administrator list) + a Pattern C form in a modal for invite/edit
// (design-system/docs/PAGE_PATTERNS.md).

const MODULE_KEYS: LicenseModuleKey[] = [
  "ENDPOINT_MANAGER",
  "NETWORK_MANAGER",
  "SOFTWARE_MANAGER",
  "SECURITY_MANAGER",
  "DATA_MANAGER",
  "USER_MANAGER",
  "THREAT_PROTECTION",
];
const MODULE_LABELS = LICENSE_MODULE_LABELS;
// Narrower grants on top of the modules; labels for the list and the form.
const GRANT_LABELS: Record<AdminGrantKey, string> = { ...LICENSE_MODULE_LABELS, USER_RISK: "User risk access" } as Record<AdminGrantKey, string>;

const ADMIN_FORM_ID = "admin-user-form";

// Green "Signed in" with the address of every browser signed in to this account right now
// (the same account can be signed in from two places at once), red "Not signed in" otherwise.
// The colours were asked for explicitly; the words carry the meaning too (rule 4).
// Sign-ins through a proxy on the server itself (a dev proxy, a tunnel) arrive from loopback.
const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+)$/;

function SignInStatus({ sessions }: { sessions: AdminActiveSession[] }) {
  if (sessions.length === 0) {
    return (
      <span className="ep-pill" style={{ "--ep-c": "var(--ep-sev-critical)" } as CSSProperties}>
        Not signed in
      </span>
    );
  }
  return (
    <div>
      <span className="ep-pill" style={{ "--ep-c": "var(--ep-ok)" } as CSSProperties}>
        Signed in{sessions.length > 1 ? ` · ${sessions.length} places` : ""}
      </span>
      {sessions.map((s, i) => (
        <span
          key={`${s.signedInAt}-${i}`}
          className="app-row-sub"
          title={`Signed in ${formatDateTime(s.signedInAt)} · last active ${formatRelative(s.lastSeenAt)}`}
        >
          <span className="ep-mono">{s.ipAddress ?? "Unknown address"}</span>
          {s.ipAddress && LOOPBACK.test(s.ipAddress) ? " (this server)" : ""} · since {formatRelative(s.signedInAt)}
        </span>
      ))}
    </div>
  );
}

export default function AdminUsersPage() {
  const { data: me } = useMe();
  const { data: admins, isLoading, error: loadError, refetch } = useAdminUsers();
  const create = useCreateAdminUser();
  const update = useUpdateAdminUser();
  const del = useDeleteAdminUser();
  const confirm = useConfirm();
  const prompt = usePrompt();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("ADMIN");
  const [moduleGrants, setModuleGrants] = useState<Set<AdminGrantKey>>(new Set());

  const paged = usePagedList(admins ?? [], 25);

  const isEditing = editingId !== null;
  const formOpen = creating || isEditing;
  const pending = isEditing ? update.isPending : create.isPending;
  const mutationError = isEditing ? update.error : create.error;
  const superAdminCount = admins?.filter((a) => a.role === "SUPER_ADMIN").length ?? 0;
  // True only while editing the single remaining super admin and the form's role has been
  // changed away from SUPER_ADMIN - blocked client-side to avoid a round trip to the same
  // check the server also enforces (updateAdminUser's LastSuperAdminError).
  const wouldRemoveLastSuperAdmin =
    isEditing &&
    role === "ADMIN" &&
    superAdminCount <= 1 &&
    admins?.find((a) => a.id === editingId)?.role === "SUPER_ADMIN";

  function resetForm() {
    setCreating(false);
    setEditingId(null);
    setEditingEmail("");
    setEmail("");
    setPassword("");
    setRole("ADMIN");
    setModuleGrants(new Set());
  }

  function startCreate() {
    resetForm();
    setCreating(true);
  }

  function startEdit(admin: AdminUserListItem) {
    setCreating(false);
    setEditingId(admin.id);
    setEditingEmail(admin.email);
    setRole(admin.role);
    setModuleGrants(new Set(admin.moduleGrants));
  }

  function toggleModule(key: AdminGrantKey) {
    setModuleGrants((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (isEditing) {
      update.mutate({ id: editingId!, role, moduleGrants: Array.from(moduleGrants) }, { onSuccess: resetForm });
    } else {
      create.mutate({ email, password, role, moduleGrants: Array.from(moduleGrants) }, { onSuccess: resetForm });
    }
  }

  async function handleResetPassword(admin: AdminUserListItem) {
    const newPassword = await prompt({
      title: `Reset Password for ${admin.email}?`,
      label: "New password",
      type: "password",
      help: "At least 8 characters.",
      confirmLabel: "Reset password",
      validate: (value) => (value.length < 8 ? "Enter a password of at least 8 characters." : null),
    });
    if (!newPassword) return;
    update.mutate({ id: admin.id, password: newPassword });
  }

  async function handleDelete(admin: AdminUserListItem) {
    const confirmed = await confirm({
      title: `Delete Admin Account "${admin.email}"?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete account",
      tone: "danger",
    });
    if (!confirmed) return;
    del.mutate(admin.id);
  }

  const submitDisabled = pending || wouldRemoveLastSuperAdmin || (!isEditing && (!email.trim() || password.length < 8));

  return (
    <>
      <PageHeader
        title="Administrators"
        description="Manage who can log in to this console and which modules they can access."
        actions={
          <Button variant="primary" icon={UserPlus} onClick={startCreate}>
            Add administrator
          </Button>
        }
      />

      <Card
        flush
        title="Console Administrators"
        hint="only super admins can see or change this page — a super admin has access to every module and can create other super admins"
      >
        {del.isError && (
          <div className="ep-cb">
            <Alert tone="critical">{(del.error as Error).message}</Alert>
          </div>
        )}
        {update.isError && !formOpen && (
          <div className="ep-cb">
            <Alert tone="critical">{(update.error as Error).message}</Alert>
          </div>
        )}
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : loadError ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load administrators"
              action={
                <Button size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            >
              {(loadError as Error).message}
            </Alert>
          </div>
        ) : !admins || admins.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No administrators yet"
            action={
              <Button size="sm" icon={UserPlus} onClick={startCreate}>
                Add administrator
              </Button>
            }
          >
            Add an administrator so someone else can sign in to this console.
          </EmptyState>
        ) : (
          <>
            <div className="app-table-scroll">
              <table className="ep-tbl">
                <thead>
                  <tr>
                    <th scope="col">Administrator</th>
                    <th scope="col">Status</th>
                    <th scope="col">Role</th>
                    <th scope="col">Module access</th>
                    <th scope="col">Last login</th>
                    <th scope="col">Created</th>
                    <th scope="col">
                      <span className="app-vh">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paged.pageItems.map((admin) => {
                    const isLastSuperAdmin = admin.role === "SUPER_ADMIN" && superAdminCount <= 1;
                    const isSelf = admin.id === me?.id;
                    const isSuper = admin.role === "SUPER_ADMIN";
                    const deleteLabel = isSelf
                      ? "Delete — you can't delete your own account"
                      : isLastSuperAdmin
                        ? "Delete — promote another admin to super admin first"
                        : "Delete";
                    return (
                      <tr key={admin.id} className={admin.id === editingId ? "ep-sel" : undefined}>
                        <td className="ep-host">
                          <b>
                            {admin.email}
                            {isSelf && <span className="app-muted"> (you)</span>}
                          </b>
                          <span className="app-row-sub">{isSuper ? "Super admin" : "Admin"}</span>
                        </td>
                        <td>
                          <SignInStatus sessions={admin.activeSessions ?? []} />
                        </td>
                        <td>{isSuper ? <Badge tone="low">Super admin</Badge> : <Badge tone="neu">Admin</Badge>}</td>
                        <td>
                          {isSuper ? (
                            <span className="app-muted">All (super admin)</span>
                          ) : admin.moduleGrants.length === 0 ? (
                            <span className="app-muted">None</span>
                          ) : (
                            <div className="app-badge-row">
                              {admin.moduleGrants.map((m) => (
                                <Tag key={m}>{GRANT_LABELS[m] ?? m}</Tag>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="app-muted" title={formatDateTime(admin.lastLoginAt, "Never")}>
                          {formatRelative(admin.lastLoginAt, "Never")}
                        </td>
                        <td className="app-muted">{formatDate(admin.createdAt)}</td>
                        <td>
                          <div className="app-cell-actions">
                            <RowMenu
                              label={`Actions for ${admin.email}`}
                              items={[
                                { label: "Edit", icon: Pencil, onSelect: () => startEdit(admin) },
                                {
                                  label: "Reset password",
                                  icon: KeyRound,
                                  disabled: update.isPending,
                                  onSelect: () => handleResetPassword(admin),
                                },
                                {
                                  label: deleteLabel,
                                  icon: Trash2,
                                  danger: true,
                                  dividerBefore: true,
                                  disabled: del.isPending || isSelf || isLastSuperAdmin,
                                  onSelect: () => handleDelete(admin),
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {paged.total > paged.pageSize && (
              <Pagination
                page={paged.page}
                pageSize={paged.pageSize}
                total={paged.total}
                noun="administrators"
                onPageChange={paged.setPage}
                onPageSizeChange={paged.setPageSize}
              />
            )}
          </>
        )}
      </Card>

      {formOpen && (
        <Modal
          title={isEditing ? `Edit ${editingEmail}` : "Add Administrator"}
          description={
            isEditing
              ? "Change this administrator's role and the modules they can access."
              : "The new administrator signs in with this email and password."
          }
          onClose={resetForm}
          footer={
            <>
              <Button onClick={resetForm}>Cancel</Button>
              <Button variant="primary" type="submit" form={ADMIN_FORM_ID} disabled={submitDisabled}>
                {pending ? "Saving…" : isEditing ? "Save changes" : "Add administrator"}
              </Button>
            </>
          }
        >
          <form id={ADMIN_FORM_ID} onSubmit={handleSubmit} className="app-stack">
            <FormSection title="Account">
              <FormGrid>
                {!isEditing && (
                  <>
                    <Field label="Email" htmlFor="admin-email" required span2>
                      <input
                        id="admin-email"
                        className="ep-input"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </Field>
                    <Field label="Password" htmlFor="admin-password" required help="At least 8 characters.">
                      <input
                        id="admin-password"
                        className="ep-input"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        minLength={8}
                        required
                      />
                    </Field>
                  </>
                )}
                <Field label="Role" htmlFor="admin-role">
                  <select id="admin-role" className="ep-select" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
                    <option value="ADMIN">Admin</option>
                    <option value="SUPER_ADMIN">Super admin</option>
                  </select>
                </Field>
              </FormGrid>
            </FormSection>
            <FormSection title="Module Access" description={role === "ADMIN" ? "Choose which modules this admin can open." : undefined}>
              {role === "ADMIN" ? (
                <div className="app-check-grid">
                  {MODULE_KEYS.map((key) => (
                    <Check key={key} checked={moduleGrants.has(key)} onChange={() => toggleModule(key)} label={MODULE_LABELS[key]} />
                  ))}
                </div>
              ) : (
                <p className="app-muted">Super admins have access to every module automatically.</p>
              )}
            </FormSection>
            {role === "ADMIN" && (
              <FormSection title="Sensitive Access" description="Areas that show individual people's activity. Give them only to admins who investigate users.">
                <Check
                  checked={moduleGrants.has("USER_RISK")}
                  onChange={() => toggleModule("USER_RISK")}
                  label="User risk"
                  hint="Risk scores, alerts and each user's activity timeline (also needs Identity Governance)"
                />
              </FormSection>
            )}
            {wouldRemoveLastSuperAdmin && (
              <Alert tone="warn">This is the last super admin — promote another admin to super admin before demoting this one.</Alert>
            )}
            {!!mutationError && <Alert tone="critical">{(mutationError as Error).message}</Alert>}
          </form>
        </Modal>
      )}
    </>
  );
}
