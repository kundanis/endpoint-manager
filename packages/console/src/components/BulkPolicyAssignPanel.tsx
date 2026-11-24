import { useState } from "react";
import { useAgents, useAssetGroups } from "../api/hooks";
import EndpointCheckboxList from "./EndpointCheckboxList";
import { Alert, Button, Card, Check, useConfirm } from "./ui";
import { confirmLargeBlockingAssignment } from "./policy";

// Shared "assign N selected policies at once" panel for every EPM category page (App
// Control, Web Block, PII Block, Command Block, IP Block, USB Control). Each of those
// pages already has a per-policy AssignmentPanel for assigning ONE opened policy; this is
// the sibling for the policy LIST's checkbox column — pick several policies, then assign
// all of them to the same group(s)/host(s) in one action instead of opening each one.
export default function BulkPolicyAssignPanel({
  policyIds,
  onAssign,
  onDone,
}: {
  policyIds: string[];
  // One policyId at a time — this component fires it once per selected policy (in
  // parallel) rather than requiring every caller to build its own bulk API endpoint.
  onAssign: (args: { policyId: string; agentIds: string[]; groupIds: string[] }) => Promise<unknown>;
  // Called after every policy assigns successfully - callers use this to clear their
  // policy checkbox selection.
  onDone: () => void;
}) {
  const { data: agents } = useAgents();
  const { data: groups } = useAssetGroups();
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  if (policyIds.length === 0) return null;

  function toggleAgent(agentId: string) {
    setSelectedAgentIds((prev) => (prev.includes(agentId) ? prev.filter((id) => id !== agentId) : [...prev, agentId]));
  }

  function toggleGroup(groupId: string) {
    setSelectedGroupIds((prev) => (prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId]));
  }

  async function handleAssign() {
    if (!(await confirmLargeBlockingAssignment(confirm, selectedAgentIds, selectedGroupIds, groups ?? []))) return;
    setError(null);
    setIsSubmitting(true);
    try {
      await Promise.all(policyIds.map((policyId) => onAssign({ policyId, agentIds: selectedAgentIds, groupIds: selectedGroupIds })));
      setSelectedAgentIds([]);
      setSelectedGroupIds([]);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const plural = policyIds.length === 1 ? "policy" : "policies";

  return (
    <Card title={`Assign ${policyIds.length} Selected ${plural}`} hint="to groups or individual endpoints">
      <div className="app-stack">
        {groups && groups.length > 0 && (
          <div className="app-stack-sm">
            <span className="ep-label">Groups</span>
            <div className="app-check-grid">
              {groups.map((g) => (
                <Check
                  key={g.id}
                  checked={selectedGroupIds.includes(g.id)}
                  onChange={() => toggleGroup(g.id)}
                  label={
                    <>
                      {g.path ?? g.name} <span className="app-muted ep-num">({g.memberCount})</span>
                    </>
                  }
                />
              ))}
            </div>
          </div>
        )}

        <EndpointCheckboxList agents={agents} selectedAgentIds={selectedAgentIds} onToggle={toggleAgent} selectedGroupIds={selectedGroupIds} />

        {error && <Alert tone="critical">{error}</Alert>}
        <div className="app-actions-row">
          <Button
            variant="primary"
            onClick={handleAssign}
            disabled={isSubmitting || (selectedAgentIds.length === 0 && selectedGroupIds.length === 0)}
          >
            {isSubmitting ? "Assigning…" : `Assign ${policyIds.length} ${plural}`}
          </Button>
        </div>
      </div>
    </Card>
  );
}
