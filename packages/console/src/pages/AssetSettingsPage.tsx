import { useEffect, useState, type FormEvent } from "react";
import { FolderTree, ListPlus, Pencil, Trash2, UserMinus, UserPlus, Users } from "lucide-react";
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
import EndpointCheckboxList from "../components/EndpointCheckboxList";
import EndpointLabel from "../components/EndpointLabel";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  FormFooter,
  FormGrid,
  FormSection,
  IconButton,
  KeyValueList,
  PageHeader,
  Pagination,
  Pill,
  Row,
  RowMenu,
  Skeleton,
  Tabs,
  Tag,
  useConfirm,
  usePagedList,
} from "../components/ui";
import { formatDateTime } from "../format";

// Pattern E — settings (design-system/docs/PAGE_PATTERNS.md): one tab per setting group,
// each section a Pattern C form that saves on its own.

const FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  TEXT: "Text",
  NUMBER: "Number",
  DATE: "Date",
  SELECT: "Select",
};

function TamperProtectionSection() {
  const { data: status } = useAgentSecurityStatus();
  const setPassword = useSetUninstallPassword();
  const clearPassword = useClearUninstallPassword();
  const confirm = useConfirm();

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

  async function handleRemove() {
    const confirmed = await confirm({
      title: "Remove uninstall protection?",
      body: "Anyone with admin access to a managed endpoint will be able to uninstall the agent without a password.",
      confirmLabel: "Remove protection",
      tone: "danger",
    });
    if (!confirmed) return;
    clearPassword.mutate();
  }

  return (
    <Row layout="21">
      <form className="ep-card" onSubmit={handleSubmit}>
        <FormSection
          title="Uninstall password"
          description="Whoever runs the uninstaller on an endpoint must also enter this password."
        >
          <div className="app-stack">
            {status ? (
              <KeyValueList
                items={[
                  {
                    label: "Status",
                    value: status.uninstallProtectionEnabled ? <Pill tone="ok">Enabled</Pill> : <Pill tone="neutral">Not set</Pill>,
                  },
                  { label: "Last changed", value: formatDateTime(status.updatedAt) },
                ]}
              />
            ) : (
              <Skeleton lines={2} />
            )}
            <FormGrid>
              <Field label={status?.uninstallProtectionEnabled ? "New password" : "Password"} htmlFor="uninstall-password" required help="At least 8 characters.">
                <input
                  id="uninstall-password"
                  className="ep-input"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  minLength={8}
                  required
                />
              </Field>
              <Field label="Confirm password" htmlFor="uninstall-password-confirm" required error={formError ?? undefined}>
                <input
                  id="uninstall-password-confirm"
                  className={`ep-input ${formError ? "ep-invalid" : ""}`}
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={8}
                  required
                  aria-invalid={formError ? true : undefined}
                />
              </Field>
            </FormGrid>
            {setPassword.isError && <Alert tone="critical">{(setPassword.error as Error).message}</Alert>}
            {clearPassword.isError && <Alert tone="critical">{(clearPassword.error as Error).message}</Alert>}
          </div>
        </FormSection>
        <FormFooter>
          {status?.uninstallProtectionEnabled && (
            <Button variant="danger" onClick={handleRemove} disabled={clearPassword.isPending}>
              {clearPassword.isPending ? "Removing…" : "Remove protection"}
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={setPassword.isPending}>
            {setPassword.isPending ? "Saving…" : status?.uninstallProtectionEnabled ? "Change password" : "Set password"}
          </Button>
        </FormFooter>
      </form>

      <Card title="How tamper protection works">
        <p className="app-text">
          Managed endpoints resist casual attempts to stop or remove the agent — the Scheduled Task and a watchdog task
          restore each other if either is disabled, and the installed files are locked against deletion by anything
          but the system account. This is a strong deterrent, not an absolute guarantee against a determined local
          administrator with enough know-how.
        </p>
        <p className="app-text">
          Uninstalling still requires physically running the uninstaller on the endpoint. Setting a password here
          requires whoever runs it to also know this password — verified against this server at uninstall time, so it
          can never be bypassed by working offline.
        </p>
      </Card>
    </Row>
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
    <form className="ep-card" onSubmit={handleSave}>
      <FormSection title="Group settings" description="Rename the group or change its description.">
        <div className="app-stack">
          <Field label="Name" htmlFor={`group-name-${group.id}`} required>
            <input id={`group-name-${group.id}`} className="ep-input" type="text" value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Description" htmlFor={`group-desc-${group.id}`}>
            <input
              id={`group-desc-${group.id}`}
              className="ep-input"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
          {updateGroup.isError && <Alert tone="critical">{(updateGroup.error as Error).message}</Alert>}
        </div>
      </FormSection>
      <FormFooter>
        {updateGroup.isSuccess && !updateGroup.isPending && <span className="app-saved">Saved</span>}
        <Button type="submit" variant="primary" disabled={updateGroup.isPending || !name.trim()}>
          {updateGroup.isPending ? "Saving…" : "Save changes"}
        </Button>
      </FormFooter>
    </form>
  );
}

function GroupsSection() {
  const { data: groups, isLoading, error, refetch } = useAssetGroups();
  const { data: agents } = useAgents();
  const createGroup = useCreateAssetGroup();
  const deleteGroup = useDeleteAssetGroup();
  const addMembers = useAddGroupMembers();
  const removeMember = useRemoveGroupMember();
  const confirm = useConfirm();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | undefined>();
  const [memberPickerAgentIds, setMemberPickerAgentIds] = useState<string[]>([]);

  const { data: groupDetail } = useAssetGroup(selectedGroupId);
  const pagedGroups = usePagedList(groups ?? [], 25);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    createGroup.mutate(
      { name, description: description || null },
      { onSuccess: () => { setName(""); setDescription(""); } },
    );
  }

  async function handleDelete(id: string, groupName: string) {
    const confirmed = await confirm({
      title: `Delete group "${groupName}"?`,
      body: "The endpoints in it stay enrolled; only the group is removed. This cannot be undone.",
      confirmLabel: "Delete group",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteGroup.mutate(id);
    if (selectedGroupId === id) setSelectedGroupId(undefined);
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
  // The picker (EndpointCheckboxList) filters by hostname and logged-on user itself.
  const availableAgents = agents?.filter((a) => !memberIds.has(a.id));

  return (
    <div className="app-stack">
      <Row layout="21">
        <Card flush title="Asset groups" hint={groups ? `${groups.length} total · select a group to manage its members` : undefined}>
          {deleteGroup.isError && (
            <div className="ep-cb">
              <Alert tone="critical">{(deleteGroup.error as Error).message}</Alert>
            </div>
          )}
          {isLoading ? (
            <div className="ep-cb">
              <Skeleton />
            </div>
          ) : error ? (
            <div className="ep-cb">
              <Alert
                tone="critical"
                title="Couldn't load groups"
                action={
                  <Button size="sm" onClick={() => refetch()}>
                    Retry
                  </Button>
                }
              >
                {(error as Error).message}
              </Alert>
            </div>
          ) : !groups || groups.length === 0 ? (
            <EmptyState icon={FolderTree} title="No groups yet">
              Create a group with the form alongside, then add endpoints to it to target policies and updates at once.
            </EmptyState>
          ) : (
            <>
              <div className="app-table-scroll">
                <table className="ep-tbl">
                  <thead>
                    <tr>
                      <th scope="col">Group</th>
                      <th scope="col" style={{ textAlign: "right" }}>
                        Members
                      </th>
                      <th scope="col">
                        <span className="app-vh">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedGroups.pageItems.map((g) => (
                      <tr key={g.id} className={`app-clickable ${g.id === selectedGroupId ? "ep-sel" : ""}`} onClick={() => setSelectedGroupId(g.id)}>
                        <td className="ep-host">
                          <b>{g.name}</b>
                          {g.description ? <span className="app-row-sub">{g.description}</span> : <span className="app-row-sub">—</span>}
                        </td>
                        <td className="ep-num" style={{ textAlign: "right" }}>
                          {g.memberCount}
                        </td>
                        <td>
                          <div className="app-cell-actions">
                            <RowMenu
                              label={`Actions for ${g.name}`}
                              items={[
                                { label: "Manage group", icon: Pencil, onSelect: () => setSelectedGroupId(g.id) },
                                {
                                  label: "Delete group",
                                  icon: Trash2,
                                  danger: true,
                                  dividerBefore: true,
                                  disabled: deleteGroup.isPending,
                                  onSelect: () => handleDelete(g.id, g.name),
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {pagedGroups.total > pagedGroups.pageSize && (
                <Pagination
                  page={pagedGroups.page}
                  pageSize={pagedGroups.pageSize}
                  total={pagedGroups.total}
                  noun="groups"
                  onPageChange={pagedGroups.setPage}
                />
              )}
            </>
          )}
        </Card>

        <form className="ep-card" onSubmit={handleCreate}>
          <FormSection title="Create group" description="Groups let you target policies, packages and updates at many endpoints at once.">
            <div className="app-stack">
              <Field label="Name" htmlFor="new-group-name" required>
                <input id="new-group-name" className="ep-input" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
              <Field label="Description" htmlFor="new-group-desc">
                <input id="new-group-desc" className="ep-input" value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>
              {createGroup.isError && <Alert tone="critical">{(createGroup.error as Error).message}</Alert>}
            </div>
          </FormSection>
          <FormFooter>
            <Button type="submit" variant="primary" icon={ListPlus} disabled={createGroup.isPending}>
              {createGroup.isPending ? "Creating…" : "Create group"}
            </Button>
          </FormFooter>
        </form>
      </Row>

      {groupDetail && (
        <Row layout="21">
          <Card flush title={`${groupDetail.name} members`} hint={`${groupDetail.members.length} ${groupDetail.members.length === 1 ? "endpoint" : "endpoints"}`}>
            {removeMember.isError && (
              <div className="ep-cb">
                <Alert tone="critical">{(removeMember.error as Error).message}</Alert>
              </div>
            )}
            {groupDetail.members.length === 0 ? (
              <EmptyState icon={Users} title="No members yet">
                Pick endpoints below and select "Add selected" to put them in this group.
              </EmptyState>
            ) : (
              <div className="app-table-scroll">
                <table className="ep-tbl">
                  <thead>
                    <tr>
                      <th scope="col">Endpoint</th>
                      <th scope="col">User</th>
                      <th scope="col">
                        <span className="app-vh">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupDetail.members.map((m) => (
                      <tr key={m.agentId}>
                        <td>
                          <EndpointLabel hostname={m.hostname} agentId={m.agentId} hideUser />
                        </td>
                        <td>{m.lastLoggedOnUser ?? "—"}</td>
                        <td>
                          <div className="app-cell-actions">
                            <IconButton
                              icon={UserMinus}
                              label={`Remove ${m.hostname} from ${groupDetail.name}`}
                              onClick={() => removeMember.mutate({ groupId: groupDetail.id, agentId: m.agentId })}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="ep-cb app-stack-sm">
              <span className="app-subhead">Add members</span>
              <EndpointCheckboxList
                agents={availableAgents}
                selectedAgentIds={memberPickerAgentIds}
                onToggle={toggleMemberPick}
                legend="Endpoints not in this group"
                emptyMessage="All endpoints are already members of this group."
              />
              {addMembers.isError && <Alert tone="critical">{(addMembers.error as Error).message}</Alert>}
              <div className="app-actions-row app-end">
                <Button icon={UserPlus} onClick={handleAddMembers} disabled={memberPickerAgentIds.length === 0}>
                  Add selected{memberPickerAgentIds.length > 0 ? ` (${memberPickerAgentIds.length})` : ""}
                </Button>
              </div>
            </div>
          </Card>

          <GroupSettingsPanel group={groupDetail} />
        </Row>
      )}
    </div>
  );
}

function CustomFieldsSection() {
  const { data: fields, isLoading, error, refetch } = useCustomFieldDefinitions();
  const createField = useCreateCustomFieldDefinition();
  const deleteField = useDeleteCustomFieldDefinition();
  const confirm = useConfirm();

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

  async function handleDelete(id: string, fieldName: string) {
    const confirmed = await confirm({
      title: `Delete custom field "${fieldName}"?`,
      body: "This cannot be undone.",
      confirmLabel: "Delete field",
      tone: "danger",
    });
    if (!confirmed) return;
    deleteField.mutate(id);
  }

  return (
    <Row layout="21">
      <Card flush title="Custom fields" hint={fields ? `${fields.length} defined` : undefined}>
        {deleteField.isError && (
          <div className="ep-cb">
            <Alert tone="critical">{(deleteField.error as Error).message}</Alert>
          </div>
        )}
        {isLoading ? (
          <div className="ep-cb">
            <Skeleton />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load custom fields"
              action={
                <Button size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            >
              {(error as Error).message}
            </Alert>
          </div>
        ) : !fields || fields.length === 0 ? (
          <EmptyState icon={ListPlus} title="No custom fields yet">
            Create a field with the form alongside to record extra asset details on every endpoint.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">Field</th>
                  <th scope="col">Type</th>
                  <th scope="col">Options</th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id}>
                    <td className="ep-host">
                      <b>{f.name}</b>
                    </td>
                    <td>{FIELD_TYPE_LABELS[f.fieldType] ?? f.fieldType}</td>
                    <td>
                      {f.options.length === 0 ? (
                        <span className="app-muted">—</span>
                      ) : (
                        <div className="app-badge-row">
                          {f.options.map((o) => (
                            <Tag key={o}>{o}</Tag>
                          ))}
                        </div>
                      )}
                    </td>
                    <td>
                      <div className="app-cell-actions">
                        <IconButton
                          icon={Trash2}
                          label={`Delete ${f.name}`}
                          onClick={() => handleDelete(f.id, f.name)}
                          disabled={deleteField.isPending}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <form className="ep-card" onSubmit={handleCreate}>
        <FormSection title="Create field" description="Custom fields appear on every endpoint's asset details.">
          <div className="app-stack">
            <Field label="Name" htmlFor="new-field-name" required>
              <input id="new-field-name" className="ep-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <Field label="Type" htmlFor="new-field-type">
              <select
                id="new-field-type"
                className="ep-select"
                value={fieldType}
                onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
              >
                <option value="TEXT">Text</option>
                <option value="NUMBER">Number</option>
                <option value="DATE">Date</option>
                <option value="SELECT">Select</option>
              </select>
            </Field>
            {fieldType === "SELECT" && (
              <Field label="Options" htmlFor="new-field-options" help="Separate options with commas.">
                <input
                  id="new-field-options"
                  className="ep-input"
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder="Finance, IT, HR"
                />
              </Field>
            )}
            {createField.isError && <Alert tone="critical">{(createField.error as Error).message}</Alert>}
          </div>
        </FormSection>
        <FormFooter>
          <Button type="submit" variant="primary" icon={ListPlus} disabled={createField.isPending}>
            {createField.isPending ? "Creating…" : "Create field"}
          </Button>
        </FormFooter>
      </form>
    </Row>
  );
}

type SettingsTab = "tamper" | "groups" | "fields";

export default function AssetSettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("tamper");
  return (
    <>
      <PageHeader title="Asset settings" description="Tamper protection, asset groups and custom fields for every managed endpoint." />
      <Tabs
        value={tab}
        onChange={(v) => setTab(v as SettingsTab)}
        items={[
          { value: "tamper", label: "Tamper protection" },
          { value: "groups", label: "Asset groups" },
          { value: "fields", label: "Custom fields" },
        ]}
      />
      {tab === "tamper" && <TamperProtectionSection />}
      {tab === "groups" && <GroupsSection />}
      {tab === "fields" && <CustomFieldsSection />}
    </>
  );
}
