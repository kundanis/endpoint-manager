import { useState, type FormEvent } from "react";
import type { AdminRole, AdminUserListItem, LicenseModuleKey } from "../api/types";
import { useAdminUsers, useCreateAdminUser, useDeleteAdminUser, useMe, useUpdateAdminUser } from "../api/hooks";

const MODULE_KEYS: LicenseModuleKey[] = [
  "ENDPOINT_MANAGER",
  "NETWORK_MANAGER",
  "SOFTWARE_MANAGER",
  "SECURITY_MANAGER",
  "DATA_MANAGER",
  "USER_MANAGER",
];
const MODULE_LABELS: Record<LicenseModuleKey, string> = {
  ENDPOINT_MANAGER: "Endpoint Manager",
  NETWORK_MANAGER: "Network Manager",
  SOFTWARE_MANAGER: "Software Manager",
  SECURITY_MANAGER: "Security Manager",
  DATA_MANAGER: "Data Manager",
  USER_MANAGER: "User Manager",
};

export default function AdminUsersPage() {
  const { data: me } = useMe();
  const { data: admins } = useAdminUsers();
  const create = useCreateAdminUser();
  const update = useUpdateAdminUser();
  const del = useDeleteAdminUser();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEmail, setEditingEmail] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<AdminRole>("ADMIN");
  const [moduleGrants, setModuleGrants] = useState<Set<LicenseModuleKey>>(new Set());

  const isEditing = editingId !== null;
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
    setEditingId(null);
    setEditingEmail("");
    setEmail("");
    setPassword("");
    setRole("ADMIN");
    setModuleGrants(new Set());
  }

  function startEdit(admin: AdminUserListItem) {
    setEditingId(admin.id);
    setEditingEmail(admin.email);
    setRole(admin.role);
    setModuleGrants(new Set(admin.moduleGrants));
  }

  function toggleModule(key: LicenseModuleKey) {
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

  function handleResetPassword(admin: AdminUserListItem) {
    const newPassword = window.prompt(`New password for ${admin.email} (at least 8 characters):`);
    if (!newPassword) return;
    if (newPassword.length < 8) {
      window.alert("Password must be at least 8 characters.");
      return;
    }
    update.mutate({ id: admin.id, password: newPassword });
  }

  function handleDelete(admin: AdminUserListItem) {
    if (!window.confirm(`Delete admin account "${admin.email}"? This cannot be undone.`)) return;
    del.mutate(admin.id);
  }

  return (
    <div>
      <h1>Administrators</h1>
      <p>
        Manage who can log in to this console and which modules they can access. Only super admins can see or change
        this page — a super admin has access to every module and can create other super admins.
      </p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Module access</th>
            <th>Last login</th>
            <th>Created</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {admins?.map((admin) => {
            const isLastSuperAdmin = admin.role === "SUPER_ADMIN" && superAdminCount <= 1;
            const isSelf = admin.id === me?.id;
            return (
              <tr key={admin.id} className={admin.id === editingId ? "selected-row" : ""}>
                <td>
                  {admin.email}
                  {isSelf && " (you)"}
                </td>
                <td>{admin.role === "SUPER_ADMIN" ? "Super Admin" : "Admin"}</td>
                <td>
                  {admin.role === "SUPER_ADMIN"
                    ? "All (super admin)"
                    : admin.moduleGrants.map((m) => MODULE_LABELS[m]).join(", ") || "None"}
                </td>
                <td>{admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : "Never"}</td>
                <td>{new Date(admin.createdAt).toLocaleDateString()}</td>
                <td style={{ display: "flex", gap: "0.4rem" }}>
                  <button type="button" onClick={() => startEdit(admin)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => handleResetPassword(admin)} disabled={update.isPending}>
                    Reset password
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(admin)}
                    disabled={del.isPending || isSelf || isLastSuperAdmin}
                    title={isSelf ? "You can't delete your own account" : isLastSuperAdmin ? "Promote another admin to super admin first" : undefined}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
          {admins?.length === 0 && (
            <tr>
              <td colSpan={6}>No administrators yet.</td>
            </tr>
          )}
        </tbody>
      </table>
      {del.isError && <p className="error-text">{(del.error as Error).message}</p>}

      <form className="panel" onSubmit={handleSubmit}>
        <h2>{isEditing ? `Edit ${editingEmail}` : "Add administrator"}</h2>
        {!isEditing && (
          <>
            <label>
              Email
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
          </>
        )}
        <label>
          Role
          <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
            <option value="ADMIN">Admin</option>
            <option value="SUPER_ADMIN">Super Admin</option>
          </select>
        </label>
        {role === "ADMIN" ? (
          <fieldset>
            <legend>Module access</legend>
            {MODULE_KEYS.map((key) => (
              <label key={key} style={{ display: "block", fontWeight: "normal" }}>
                <input type="checkbox" checked={moduleGrants.has(key)} onChange={() => toggleModule(key)} />{" "}
                {MODULE_LABELS[key]}
              </label>
            ))}
          </fieldset>
        ) : (
          <p className="hint">Super admins have access to every module automatically.</p>
        )}
        {wouldRemoveLastSuperAdmin && (
          <p className="error-text">
            This is the last super admin — promote another admin to Super Admin before demoting this one.
          </p>
        )}
        {mutationError && <p className="error-text">{(mutationError as Error).message}</p>}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="submit"
            disabled={pending || wouldRemoveLastSuperAdmin || (!isEditing && (!email.trim() || password.length < 8))}
          >
            {pending ? "Saving…" : isEditing ? "Save changes" : "Add administrator"}
          </button>
          {isEditing && (
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
