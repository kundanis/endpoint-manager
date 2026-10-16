import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { DataTypeTarget, DataTypeView } from "@em/shared";
import { useApplyDataTypes, useDataTypeTargetPolicies } from "../api/hooks";
import { DATA_TYPE_TARGET_LABELS, DATA_TYPE_TARGET_PATHS } from "../dataTypeLabels";
import { Alert, Button, Field, FormGrid, Modal, useToast } from "./ui";

const NEW = "__new";

// "Use in policy" from the Data types page: add this data type's values to an existing DLP /
// EPM policy, or create a new policy from it in one step. A new policy does nothing until it's
// assigned to endpoints (and DLP / command blocking start in alert-only mode).
export default function UseInPolicyDialog({ dataType, onClose }: { dataType: DataTypeView; onClose: () => void }) {
  const [target, setTarget] = useState<DataTypeTarget>(dataType.targets[0]);
  const { data: policies } = useDataTypeTargetPolicies(target);
  const [policyId, setPolicyId] = useState(NEW);
  const [newName, setNewName] = useState(dataType.name);
  const apply = useApplyDataTypes();
  const toast = useToast();
  const navigate = useNavigate();

  const creating = policyId === NEW;

  function chooseTarget(next: DataTypeTarget) {
    setTarget(next);
    setPolicyId(NEW);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    apply.mutate(
      creating
        ? { target, newPolicyName: newName.trim(), dataTypeIds: [dataType.id] }
        : { target, policyId, dataTypeIds: [dataType.id] },
      {
        onSuccess: (r) => {
          toast(
            creating
              ? `Created policy "${newName.trim()}" with ${r.added} ${r.added === 1 ? "rule" : "rules"}. Assign it to endpoints to start enforcing it.`
              : `Added ${r.added} ${r.added === 1 ? "rule" : "rules"}${r.skipped ? ` (${r.skipped} already there)` : ""}.`,
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
      description={`Each of its ${dataType.values.length} values becomes a rule in the policy.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            form="use-in-policy-form"
            variant="primary"
            disabled={apply.isPending || (creating && !newName.trim())}
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
        {apply.isError && <Alert tone="critical">{(apply.error as Error).message}</Alert>}
      </form>
    </Modal>
  );
}
