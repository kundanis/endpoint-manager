import { useEffect, useState, type FormEvent } from "react";
import type { CustomFieldType } from "../api/types";
import { useAgents } from "../api/hooks";
import {
  useAddGroupMembers,
  useAgentSecurityStatus,
  useAssetGroup,
  useAssetGroups,
  useClearUninstallPassword,
  useCreateAssetGroup,
  useCreateCustomFieldDefinition,
  useCustomFieldDefinitions,
  useDeleteAssetGroup,
  useDeleteCustomFieldDefinition,
  useRemoveGroupMember,
  useSetUninstallPassword,
  useUpdateAssetGroup,
} from "../api/hooks";

function TamperProtectionSection() {
  const { data: status } = useAgentSecurityStatus();
  const setPassword = useSetUninstallPassword();
  const clearPassword = useClearUninstallPassword();

  const [password, setPasswordInput] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (password !== confirmPassword) {
      setFormError("Passwords don't match.");
      return;
    }
    setPassword.mutate(password, {
      onSuccess: () => {
        setPasswordInput("");
        setConfirmPassword("");
      },
    });
  }

  function handleRemove() {
    const confirmed = window.confirm(
      "Remove uninstall protection?\n\nAnyone with admin access to a managed endpoint will be able to uninstall the agent without a password.",
    );
    if (!confirmed) return;
    clearPassword.mutate();
  }

  return (
    <section>
      <h2>Tamper Protection</h2>
      <p>
        Managed endpoints resist casual attempts to stop or remove the agent — the Scheduled Task and a watchdog task
        restore each other if either is disabled, and the installed files are locked against deletion by anything
        but the system account. This is a strong deterrent, not an absolute guarantee against a determined local
        administrator with enough know-how.
      </p>
      <p>
        Uninstalling still requires physically running the uninstaller on the endpoint. Setting a password here
        requires whoever runs it to also know this password — verified against this server at uninstall time, so it
        can never be bypassed by working offline.
      </p>

      <div className="panel">
        <h3>Uninstall password</h3>
        <p>
          Status:{" "}
          <span className={`status-badge ${status?.uninstallProtectionEnabled ? "online" : "offline"}`}>
            {status?.uninstallProtectionEnabled ? "Enabled" : "Not set"}
          </span>
          {status?.updatedAt && ` — last changed ${new Date(status.updatedAt).toLocaleString()}`}
        </p>

        <form onSubmit={handleSubmit}>
          <label>
            {status?.uninstallProtectionEnabled ? "New password" : "Password"}
            <input
              type="password"
              value={password}
              onChange={(e) => setPasswordInput(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <label>
            Confirm password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {formError && <p className="error-text">{formError}</p>}
          {setPassword.isError && <p className="error-text">{(setPassword.error as Error).message}</p>}
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button type="submit" disabled={setPassword.isPending}>
              {setPassword.isPending ? "Saving…" : status?.uninstallProtectionEnabled ? "Change password" : "Set password"}
            </button>
            {status?.uninstallProtectionEnabled && (
              <button type="button" onClick={handleRemove} disabled={clearPassword.isPending}>
                {clearPassword.isPending ? "Removing…" : "Remove protection"}
              </button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}

function GroupSettingsPanel({ group }: { group: { id: string; name: string; description: string | null } }) {
  const updateGroup = useUpdateAssetGroup();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");

  useEffect(() => {
    setName(group.name);
    setDescription(group.description ?? "");
  }, [group.id, group.name, group.description]);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    updateGroup.mutate({ id: group.id, name, description: description.trim() || null });
  }

  return (
    <form className="card accent-blue" onSubmit={handleSave}>
      <h3>Group settings</h3>
      <label>
        Name
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        Description
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {updateGroup.isError && <p className="error-text">{(updateGroup.error as Error).message}</p>}
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
        <button type="submit" disabled={updateGroup.isPending || !name.trim()}>
          {updateGroup.isPending ? "Saving…" : "Save changes"}
        </button>
        {updateGroup.isSuccess && <span style={{ color: "var(--online)", fontSize: "0.85rem" }}>Saved</span>}
      </div>
    </form>
  );
}

function GroupsSection() {
  const { data: groups } = useAssetGroups();
  const { data: agents } = useAgents();
  const createGroup = useCreateAssetGroup();
  const deleteGroup = useDeleteAssetGroup();
  const addMembers = useAddGroupMembers();
  const removeMember = useRemoveGroupMember();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>();
  const [memberPickerAgentIds, setMemberPickerAgentIds] = useState<string[]>([]);

  const { data: groupDetail } = useAssetGroup(selectedGroupId);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createGroup.mutate(
      { name, description: description || null },
      { onSuccess: () => { setName(""); setDescription(""); } },
    );
  }

  function toggleMemberPick(agentId: string) {
    setMemberPickerAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function handleAddMembers() {
    if (!selectedGroupId || memberPickerAgentIds.length === 0) return;
    addMembers.mutate(
      { groupId: selectedGroupId, agentIds: memberPickerAgentIds },
      { onSuccess: () => setMemberPickerAgentIds([]) },
    );
  }

  const memberIds = new Set(groupDetail?.members.map((m) => m.agentId) ?? []);
  const availableAgents = agents?.filter((a) => !memberIds.has(a.id)) ?? [];

  return (
    <section>
      <h2>Asset Groups</h2>

      <form className="panel" onSubmit={handleCreate}>
        <h3>Create group</h3>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Description
          <input value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {createGroup.isError && <p className="error-text">{(createGroup.error as Error).message}</p>}
        <button type="submit" disabled={createGroup.isPending}>
          {createGroup.isPending ? "Creating…" : "Create group"}
        </button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Description</th>
            <th>Members</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {groups?.map((g) => (
            <tr key={g.id} className="clickable-row" onClick={() => setSelectedGroupId(g.id)}>
              <td>{g.name}</td>
              <td>{g.description ?? "—"}</td>
              <td>{g.memberCount}</td>
              <td>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteGroup.mutate(g.id);
                    if (selectedGroupId === g.id) setSelectedGroupId(undefined);
                  }}
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {groups?.length === 0 && (
            <tr>
              <td colSpan={4}>No groups yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      {groupDetail && <GroupSettingsPanel group={groupDetail} />}

      {groupDetail && (
        <div className="panel">
          <h3>{groupDetail.name} — members</h3>
          <table className="data-table">
            <thead>
              <tr>
                <th>Hostname</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {groupDetail.members.map((m) => (
                <tr key={m.agentId}>
                  <td>{m.hostname}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => removeMember.mutate({ groupId: groupDetail.id, agentId: m.agentId })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {groupDetail.members.length === 0 && (
                <tr>
                  <td colSpan={2}>No members yet.</td>
                </tr>
              )}
            </tbody>
          </table>

          {availableAgents.length > 0 && (
            <>
              <h4>Add members</h4>
              <fieldset>
                {availableAgents.map((a) => (
                  <label key={a.id} className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={memberPickerAgentIds.includes(a.id)}
                      onChange={() => toggleMemberPick(a.id)}
                    />
                    {a.hostname}
                  </label>
                ))}
              </fieldset>
              <button type="button" onClick={handleAddMembers} disabled={memberPickerAgentIds.length === 0}>
                Add selected
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function CustomFieldsSection() {
  const { data: fields } = useCustomFieldDefinitions();
  const createField = useCreateCustomFieldDefinition();
  const deleteField = useDeleteCustomFieldDefinition();

  const [name, setName] = useState("");
  const [fieldType, setFieldType] = useState<CustomFieldType>("TEXT");
  const [optionsText, setOptionsText] = useState("");

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    const options =
      fieldType === "SELECT"
        ? optionsText.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    createField.mutate(
      { name, fieldType, options },
      { onSuccess: () => { setName(""); setOptionsText(""); } },
    );
  }

  return (
    <section>
      <h2>Custom Fields</h2>

      <form className="panel" onSubmit={handleCreate}>
        <h3>Create field</h3>
        <label>
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Type
          <select value={fieldType} onChange={(e) => setFieldType(e.target.value as CustomFieldType)}>
            <option value="TEXT">Text</option>
            <option value="NUMBER">Number</option>
            <option value="DATE">Date</option>
            <option value="SELECT">Select</option>
          </select>
        </label>
        {fieldType === "SELECT" && (
          <label>
            Options (comma-separated)
            <input value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder="Finance, IT, HR" />
          </label>
        )}
        {createField.isError && <p className="error-text">{(createField.error as Error).message}</p>}
        <button type="submit" disabled={createField.isPending}>
          {createField.isPending ? "Creating…" : "Create field"}
        </button>
      </form>

      <table className="data-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Options</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {fields?.map((f) => (
            <tr key={f.id}>
              <td>{f.name}</td>
              <td>{f.fieldType}</td>
              <td>{f.options.join(", ") || "—"}</td>
              <td>
                <button type="button" onClick={() => deleteField.mutate(f.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {fields?.length === 0 && (
            <tr>
              <td colSpan={4}>No custom fields yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

export default function AssetSettingsPage() {
  return (
    <div>
      <h1>Asset Settings</h1>
      <TamperProtectionSection />
      <GroupsSection />
      <CustomFieldsSection />
    </div>
  );
}
