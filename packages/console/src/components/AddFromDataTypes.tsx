import { useState } from "react";
import { Link } from "react-router-dom";
import { Database } from "lucide-react";
import type { DataTypeTarget } from "@em/shared";
import { DATA_TYPE_KIND_LABELS } from "../dataTypeLabels";
import { useApplyDataTypes, useDataTypes } from "../api/hooks";
import { Alert, Button, Check, Modal, Skeleton, useToast } from "./ui";

// "Add from data type" on a DLP / EPM policy's rules: pick one or more data types (built-in
// or custom) that fit this policy area, and every value becomes a rule. Values the policy
// already has are skipped.
export default function AddFromDataTypes({ target, policyId }: { target: DataTypeTarget; policyId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="app-actions-row">
      <Button size="sm" icon={Database} onClick={() => setOpen(true)}>
        Add from data type
      </Button>
      {open && <AddFromDataTypesDialog target={target} policyId={policyId} onClose={() => setOpen(false)} />}
    </div>
  );
}

function AddFromDataTypesDialog({ target, policyId, onClose }: { target: DataTypeTarget; policyId: string; onClose: () => void }) {
  const { data: dataTypes, error } = useDataTypes();
  const apply = useApplyDataTypes();
  const toast = useToast();
  const [selected, setSelected] = useState<string[]>([]);

  const compatible = (dataTypes ?? []).filter((d) => d.targets.includes(target));
  const categories = [...new Set(compatible.map((d) => d.category))];
  const valueCount = compatible.filter((d) => selected.includes(d.id)).reduce((n, d) => n + d.values.length, 0);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function handleApply() {
    apply.mutate(
      { target, policyId, dataTypeIds: selected },
      {
        onSuccess: (r) => {
          toast(
            `Added ${r.added} ${r.added === 1 ? "rule" : "rules"}` +
              (r.skipped ? ` (${r.skipped} already in this policy)` : "") +
              "." +
              (r.refused && r.refused.length > 0 ? ` ${r.refused.length} value${r.refused.length === 1 ? " was" : "s were"} left out because blocking ${r.refused.length === 1 ? "it" : "them"} would stop Windows itself (${r.refused.join(", ")}).` : ""),
          );
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      title="Add from data type"
      description="Each value of the chosen data types becomes a rule in this policy. Values the policy already has are skipped."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleApply} disabled={selected.length === 0 || apply.isPending}>
            {apply.isPending ? "Adding…" : selected.length ? `Add ${valueCount} ${valueCount === 1 ? "rule" : "rules"}` : "Add rules"}
          </Button>
        </>
      }
    >
      <div className="app-stack">
        {error && <Alert tone="critical">{(error as Error).message}</Alert>}
        {!dataTypes && !error && <Skeleton lines={4} />}
        {dataTypes && compatible.length === 0 && (
          <p className="app-text">
            No data type fits this policy yet. Create one under{" "}
            <Link className="ep-link" to="/data-types">
              Data types
            </Link>
            .
          </p>
        )}
        {categories.map((category) => (
          <div key={category} className="app-stack-sm">
            <span className="app-subhead">{category}</span>
            {compatible
              .filter((d) => d.category === category)
              .map((d) => (
                <Check
                  key={d.id}
                  checked={selected.includes(d.id)}
                  onChange={() => toggle(d.id)}
                  label={d.name}
                  hint={`${d.values.length} ${DATA_TYPE_KIND_LABELS[d.kind].toLowerCase()}${d.builtIn ? "" : " · custom"}`}
                />
              ))}
          </div>
        ))}
        {apply.isError && <Alert tone="critical">{(apply.error as Error).message}</Alert>}
      </div>
    </Modal>
  );
}
