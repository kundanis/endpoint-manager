import { useState, type FormEvent } from "react";
import { useAdmins, useChangeAdminPassword, useCreateAdmin, useDeleteAdmin, useMe } from "../api/hooks";
import type { AdminListItem } from "../api/types";

function ChangePasswordForm({ admin, onDone }: { admin: AdminListItem; onDone: (changed: boolean) => void }) {
  const changePassword = useChangeAdminPassword();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");

  const passwordsMatch = password === confirmPassword;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!passwordsMatch) return;
    changePassword.mutate({ id: admin.id, password, otp }, { onSuccess: () => onDone(true) });
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>Change password for {admin.email}</h2>
      <label>
        New password (at least 10 characters)
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={10}
          autoComplete="new-password"
          required
        />
      </label>
      <label>
        Confirm new password
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
      </label>
      <label>
        OTP
        <input
          type="password"
          inputMode="numeric"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          autoComplete="one-time-code"
          required
        />
      </label>
      {!passwordsMatch && confirmPassword && <p className="error-text">Passwords don't match.</p>}
      {changePassword.isError && <p className="error-text">{(changePassword.error as Error).message}</p>}
      <button
        type="submit"
        disabled={changePassword.isPending || password.length < 10 || !passwordsMatch || !otp.trim()}
      >
        {changePassword.isPending ? "Saving…" : "Change password"}
      </button>{" "}
      <button type="button" onClick={() => onDone(false)} disabled={changePassword.isPending}>
        Cancel
      </button>
    </form>
  );
}

export default function AdminsPage() {
  const { data: me } = useMe();
  const { data: admins } = useAdmins();
  const createAdmin = useCreateAdmin();
  const deleteAdmin = useDeleteAdmin();

  const [passwordAdmin, setPasswordAdmin] = useState<AdminListItem | null>(null);
  const [passwordChangedFor, setPasswordChangedFor] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // Removal is a two-click confirm: the first click arms the button, the second removes.
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);

  const passwordsMatch = password === confirmPassword;

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!passwordsMatch) return;
    createAdmin.mutate(
      { email, password },
      {
        onSuccess: () => {
          setEmail("");
          setPassword("");
          setConfirmPassword("");
        },
      },
    );
  }

  function handleRemove(id: string) {
    if (pendingRemoveId !== id) {
      setPendingRemoveId(id);
      return;
    }
    deleteAdmin.mutate(id, { onSettled: () => setPendingRemoveId(null) });
  }

  return (
    <div>
      <h1>Administrators</h1>
      <p>People who can sign in to this License Server Console.</p>

      <table className="data-table">
        <thead>
          <tr>
            <th>Email</th>
            <th>Created</th>
            <th>Last login</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {admins?.map((a) => (
            <tr key={a.id}>
              <td>
                {a.email} {a.id === me?.id && <span className="status-badge online">You</span>}
              </td>
              <td>{new Date(a.createdAt).toLocaleString()}</td>
              <td>{a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : "Never"}</td>
              <td>
                <button
                  type="button"
                  onClick={() => {
                    setPasswordAdmin(a);
                    setPasswordChangedFor(null);
                  }}
                >
                  Change password
                </button>{" "}
                {a.id !== me?.id && (
                  <button type="button" onClick={() => handleRemove(a.id)} disabled={deleteAdmin.isPending}>
                    {pendingRemoveId === a.id ? "Click again to remove" : "Remove"}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {deleteAdmin.isError && <p className="error-text">{(deleteAdmin.error as Error).message}</p>}
      {passwordChangedFor && <p className="status-badge online">Password changed for {passwordChangedFor}.</p>}

      {passwordAdmin && (
        <ChangePasswordForm
          key={passwordAdmin.id}
          admin={passwordAdmin}
          onDone={(changed) => {
            if (changed) setPasswordChangedFor(passwordAdmin.email);
            setPasswordAdmin(null);
          }}
        />
      )}

      <form className="panel" onSubmit={handleCreate}>
        <h2>New administrator</h2>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password (at least 10 characters)
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={10}
            autoComplete="new-password"
            required
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            required
          />
        </label>
        {!passwordsMatch && confirmPassword && <p className="error-text">Passwords don't match.</p>}
        {createAdmin.isError && <p className="error-text">{(createAdmin.error as Error).message}</p>}
        <button type="submit" disabled={createAdmin.isPending || !email.trim() || password.length < 10 || !passwordsMatch}>
          {createAdmin.isPending ? "Adding…" : "Add administrator"}
        </button>
      </form>
    </div>
  );
}
