import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { DataTypeTarget, DataTypeView } from "@em/shared";
import { useApplyDataTypes, useDataTypeTargetPolicies } from "../api/hooks";
import { DATA_TYPE_TARGET_LABELS, DATA_TYPE_TARGET_PATHS } from "../dataTypeLabels";
import { Alert, Button, Check, Field, FormGrid, Modal, useToast } from "./ui";

const NEW = "__new";

// "Use in policy" from the Data types page: add this data type's values (all, or the ones ticked)
// to an existing DLP / EPM policy, or create a new policy from them in one step. A new policy does nothing until it's
// assigned to endpoints (and DLP / command blocking start in alert-only mode).
export default function UseInPolicyDialog({ dataType, onClose }: { dataType: DataTypeView; onClose: () => void }) {
  const [target, setTarget] = useState<DataTypeTarget>(dataType.targets[0]);
  const { data: policies } = useDataTypeTargetPolicies(target);
  const [policyId, setPolicyId] = useState(NEW);
  const [newName, setNewName] = useState(dataType.name);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(dataType.values));
  const apply = useApplyDataTypes();
  const toast = useToast();
  const navigate = useNavigate();

  const creating = policyId === NEW;
  const allSelected = selected.size === dataType.values.length;

  function toggleValue(value: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(value);
      else next.delete(value);
      return next;
    });
  }

  function chooseTarget(next: DataTypeTarget) {
    setTarget(next);
    setPolicyId(NEW);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Every value when all are ticked, so the request stays small for long lists.
    const values = allSelected ? undefined : dataType.values.filter((v) => selected.has(v));
    apply.mutate(
      creating
        ? { target, newPolicyName: newName.trim(), dataTypeIds: [dataType.id], values }
        : { target, policyId, dataTypeIds: [dataType.id], values },
      {
        onSuccess: (r) => {
          toast(
            (creating
              ? `Created policy "${newName.trim()}" with ${r.added} ${r.added === 1 ? "rule" : "rules"}. Assign it to endpoints to start enforcing it.`
              : `Added ${r.added} ${r.added === 1 ? "rule" : "rules"}${r.skipped ? ` (${r.skipped} already there)` : ""}.`) + (r.refused && r.refused.length > 0 ? ` ${r.refused.length} value${r.refused.length === 1 ? " was" : "s were"} left out because blocking ${r.refused.length === 1 ? "it" : "them"} would stop Windows itself (${r.refused.join(", ")}).` : ""),
          );
          onClose();
          navigate(DATA_TYPE_TARGET_PATHS[target]);
        },
      },
    );
  }

  return (
    <Modal
      title={`Use "${dataType.name}" in a policy`}
      description="Each ticked value becomes a rule in the policy."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="use-in-policy-form"
            variant="primary"
            disabled={apply.isPending || selected.size === 0 || (creating && !newName.trim())}
          >
            {apply.isPending ? "Adding…" : creating ? "Create policy" : "Add to policy"}
          </Button>
        </>
      }
    >
      <form id="use-in-policy-form" className="app-stack" onSubmit={handleSubmit}>
        <FormGrid>
          <Field label="Policy area" htmlFor="uip-target" required span2>
            <select id="uip-target" className="ep-select" value={target} onChange={(e) => chooseTarget(e.target.value as DataTypeTarget)}>
              {dataType.targets.map((t) => (
                <option key={t} value={t}>
                  {DATA_TYPE_TARGET_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Policy" htmlFor="uip-policy" required span2>
            <select id="uip-policy" className="ep-select" value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
              <option value={NEW}>New policy…</option>
              {policies?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {creating && (
            <Field
              label="New policy name"
              htmlFor="uip-name"
              required
              span2
              help="Created enabled but not assigned to any endpoint - assign it on the policy page to start enforcing it."
            >
              <input id="uip-name" className="ep-input" value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} data-autofocus />
            </Field>
          )}
        </FormGrid>
        <div className="ep-field" role="group" aria-labelledby="uip-values">
          <div className="app-cell-actions" style={{ justifyContent: "space-between" }}>
            <span className="ep-label" id="uip-values">
              Values ({selected.size} of {dataType.values.length} selected)
            </span>
            <Button size="sm" variant="ghost" onClick={() => setSelected(allSelected ? new Set() : new Set(dataType.values))}>
              {allSelected ? "Clear all" : "Select all"}
            </Button>
          </div>
          <div className="app-check-grid" style={{ maxHeight: 280, overflowY: "auto" }}>
            {dataType.values.map((v) => (
              <Check
                key={v}
                checked={selected.has(v)}
                onChange={(checked) => toggleValue(v, checked)}
                label={dataType.valueLabels?.[v] ?? v}
              />
            ))}
          </div>
        </div>
        {apply.isError && <Alert tone="critical">{(apply.error as Error).message}</Alert>}
      </form>
    </Modal>
  );
}
