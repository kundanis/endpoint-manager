import { Fragment, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Database, Pencil, Plus, Send, Trash2 } from "lucide-react";
import type { DataTypeKind, DataTypeView } from "@em/shared";
import { useCreateDataType, useDataTypes, useDeleteDataType, useUpdateDataType } from "../api/hooks";
import UseInPolicyDialog from "../components/UseInPolicyDialog";
import { CUSTOM_KIND_OPTIONS, DATA_TYPE_KIND_LABELS, DATA_TYPE_TARGET_LABELS } from "../dataTypeLabels";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  FormGrid,
  IconButton,
  Modal,
  PageHeader,
  RowMenu,
  SearchInput,
  Skeleton,
  Tag,
  Toolbar,
  useConfirm,
  useToast,
} from "../components/ui";

// Data Governance -> Data types (Pattern B list). Built-in categories (file types, Indian and
// other personal data, websites, applications, keywords) plus admin-defined lists. Policies use
// them through "Add from data type" on DLP and EPM rules.

const PREVIEW = 5;

type CustomKind = Exclude<DataTypeKind, "PII_PATTERN">;

function DataTypeForm({ existing, onClose }: { existing?: DataTypeView; onClose: () => void }) {
  const create = useCreateDataType();
  const update = useUpdateDataType();
  const toast = useToast();
  const [name, setName] = useState(existing?.name ?? "");
  const [category, setCategory] = useState(existing && existing.category !== "Custom" ? existing.category : "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [kind, setKind] = useState<CustomKind>((existing?.kind as CustomKind) ?? "FILE_EXTENSION");
  const [valuesText, setValuesText] = useState(existing?.values.join("\n") ?? "");
  const mutation = existing ? update : create;

  const values = valuesText
    .split(/\r?\n|,/)
    .map((v) => v.trim())
    .filter(Boolean);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = { name: name.trim(), category: category.trim() || null, description: description.trim() || null, kind, values };
    const done = { onSuccess: () => (toast(existing ? "Data type saved." : `Data type "${body.name}" created.`), onClose()) };
    if (existing) update.mutate({ id: existing.id, ...body }, done);
    else create.mutate(body, done);
  }

  const kindOption = CUSTOM_KIND_OPTIONS.find((k) => k.value === kind)!;
  return (
    <Modal
      title={existing ? `Edit "${existing.name}"` : "New Data Type"}
      description="A named list you can add to DLP and EPM policies in one step."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="data-type-form" variant="primary" disabled={mutation.isPending || !name.trim() || values.length === 0}>
            {mutation.isPending ? "Saving…" : existing ? "Save changes" : "Create data type"}
          </Button>
        </>
      }
    >
      <form id="data-type-form" className="app-stack" onSubmit={handleSubmit}>
        <FormGrid>
          <Field label="Name" htmlFor="dt-name" required>
            <input id="dt-name" className="ep-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required data-autofocus />
          </Field>
          <Field label="Category" htmlFor="dt-category" help="Optional, e.g. Finance or Engineering. Defaults to Custom.">
            <input id="dt-category" className="ep-input" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} />
          </Field>
          <Field label="Type of values" htmlFor="dt-kind" required span2>
            <select id="dt-kind" className="ep-select" value={kind} onChange={(e) => setKind(e.target.value as CustomKind)}>
              {CUSTOM_KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description" htmlFor="dt-description" span2>
            <input id="dt-description" className="ep-input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </Field>
          <Field
            label={`Values (${values.length})`}
            htmlFor="dt-values"
            required
            span2
            help="One per line (or comma-separated). Extensions get a leading dot and domains are cleaned up automatically."
          >
            <textarea
              id="dt-values"
              className="ep-input ep-mono"
              rows={8}
              value={valuesText}
              onChange={(e) => setValuesText(e.target.value)}
              placeholder={kindOption.placeholder}
            />
          </Field>
        </FormGrid>
        {mutation.isError && <Alert tone="critical">{(mutation.error as Error).message}</Alert>}
      </form>
    </Modal>
  );
}

export default function DataTypesPage() {
  const { data: dataTypes, isLoading, error, refetch } = useDataTypes();
  const remove = useDeleteDataType();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<DataTypeView | "new" | null>(null);
  const [using, setUsing] = useState<DataTypeView | null>(null);

  const categories = [...new Set((dataTypes ?? []).map((d) => d.category))];
  const term = search.trim().toLowerCase();
  const visible = (dataTypes ?? [])
    .filter((d) => !category || d.category === category)
    .filter(
      (d) =>
        !term ||
        d.name.toLowerCase().includes(term) ||
        (d.description ?? "").toLowerCase().includes(term) ||
        d.values.some((v) => v.toLowerCase().includes(term)),
    );

  async function handleDelete(d: DataTypeView) {
    const ok = await confirm({
      title: `Delete Data Type "${d.name}"?`,
      body: "Rules already added to policies from it stay in place. This cannot be undone.",
      confirmLabel: "Delete data type",
      tone: "danger",
    });
    if (ok) remove.mutate(d.id);
  }

  return (
    <>
      <PageHeader
        title="Data Types"
        description="Ready-made and custom lists of file types, personal data, websites and applications. Select “Use in policy” to build a DLP or EPM policy from one, or use “Add from data type” inside a policy’s rules."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>
            New data type
          </Button>
        }
      />

      <Card flush title="Data Types" hint={dataTypes ? `${dataTypes.length} total` : undefined}>
        <Toolbar>
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search names and values…" />
          <select className="ep-select" aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Category: All</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Toolbar>

        {isLoading ? (
          <div className="ep-cb">
            <Skeleton lines={6} />
          </div>
        ) : error ? (
          <div className="ep-cb">
            <Alert
              tone="critical"
              title="Couldn't load data types"
              action={
                <Button size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            >
              {(error as Error).message}
            </Alert>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Database}
            title={dataTypes && dataTypes.length > 0 ? "No data type matches" : "No data types yet"}
            action={
              <Button size="sm" icon={Plus} onClick={() => setEditing("new")}>
                New data type
              </Button>
            }
          >
            Clear the search, or create your own list of extensions, websites, applications or keywords.
          </EmptyState>
        ) : (
          <div className="app-table-scroll">
            <table className="ep-tbl">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="app-vh">Expand</span>
                  </th>
                  <th scope="col">Name</th>
                  <th scope="col">Category</th>
                  <th scope="col">Values</th>
                  <th scope="col">Can be added to</th>
                  <th scope="col">Source</th>
                  <th scope="col">
                    <span className="app-vh">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((d) => {
                  const isOpen = expanded === d.id;
                  const Chevron = isOpen ? ChevronDown : ChevronRight;
                  return (
                    <Fragment key={d.id}>
                      <tr>
                        <td className="ep-cb">
                          <IconButton icon={Chevron} label={isOpen ? `Hide values of ${d.name}` : `Show values of ${d.name}`} onClick={() => setExpanded(isOpen ? null : d.id)} />
                        </td>
                        <td>
                          <div className="app-stack-sm">
                            <b>{d.name}</b>
                            {d.description && <span className="ep-hint app-clamp-2">{d.description}</span>}
                          </div>
                        </td>
                        <td>{d.category}</td>
                        <td>
                          <div className="app-stack-sm">
                            <span>
                              <span className="ep-num">{d.values.length}</span> {DATA_TYPE_KIND_LABELS[d.kind].toLowerCase()}
                            </span>
                            <span className="ep-hint ep-mono app-truncate" style={{ maxWidth: "36ch" }} title={d.values.join(", ")}>
                              {d.values.slice(0, PREVIEW).join(", ")}
                              {d.values.length > PREVIEW ? ` +${d.values.length - PREVIEW}` : ""}
                            </span>
                          </div>
                        </td>
                        <td>
                          <div className="app-badge-row">
                            {d.targets.map((t) => (
                              <Tag key={t}>{DATA_TYPE_TARGET_LABELS[t]}</Tag>
                            ))}
                          </div>
                        </td>
                        <td>{d.builtIn ? <Badge tone="ok">Built-in</Badge> : <Badge tone="neu">Custom</Badge>}</td>
                        <td>
                          <div className="app-cell-actions">
                            <Button size="sm" icon={Send} onClick={() => setUsing(d)}>
                              Use in policy
                            </Button>
                            {!d.builtIn && (
                              <RowMenu
                                label={`Actions for ${d.name}`}
                                items={[
                                  { label: "Edit", icon: Pencil, onSelect: () => setEditing(d) },
                                  { label: "Delete", icon: Trash2, danger: true, dividerBefore: true, onSelect: () => handleDelete(d) },
                                ]}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} style={{ background: "var(--ep-surface-2)" }}>
                            <div className="app-badge-row">
                              {d.values.map((v) => (
                                <span key={v} className="ep-tag ep-mono">
                                  {v}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {using && <UseInPolicyDialog dataType={using} onClose={() => setUsing(null)} />}
      {editing && <DataTypeForm existing={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </>
  );
}
