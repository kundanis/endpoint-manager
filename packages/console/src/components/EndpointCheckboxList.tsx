import { useState, type ReactNode } from "react";
import type { AgentListItem } from "../api/types";
import Collapsible from "./Collapsible";
import EndpointLabel from "./EndpointLabel";

// Shared "pick endpoints" checkbox list — used by every "Assign to" / "Target endpoints"
// panel across the console (policy assignment pages, command/patch/package/agent-update
// dispatch). Previously each page hand-copied its own <fieldset> of checkboxes showing
// hostname only; this adds the logged-on user next to each hostname, lets the list be
// filtered by host or user once the fleet gets large, collapses so a long fleet doesn't
// dominate the page, and (via `selectedGroupIds`) shows which hosts are already covered
// by a currently-selected group so it's obvious they don't need picking individually too.
export default function EndpointCheckboxList({
  agents,
  selectedAgentIds,
  onToggle,
  legend = "Endpoints",
  emptyMessage = "No endpoints enrolled yet.",
  renderExtra,
  renderRow,
  selectedGroupIds,
  defaultOpen = true,
}: {
  agents: AgentListItem[] | undefined;
  selectedAgentIds: string[];
  onToggle: (agentId: string) => void;
  legend?: string;
  emptyMessage?: string;
  // Appended after the "hostname / user / group" label inside the same <label>, e.g. a status badge or the
  // OS edition (see CommandsPage / ZeroTrustPage's respective callers).
  renderExtra?: (agent: AgentListItem) => ReactNode;
  // Escape hatch for a caller that needs to replace the row content entirely instead of
  // just appending to it (checkbox + wrapping <label> are still provided by this component).
  renderRow?: (agent: AgentListItem) => ReactNode;
  // Group ids currently checked in this same panel's group picker (pass through the
  // caller's own selectedGroupIds state). A host that's a member of one of these groups
  // is shown pre-checked and disabled — it's already covered by the group assignment, so
  // there's nothing to individually toggle.
  selectedGroupIds?: string[];
  // Collapsed by default is rarely useful here (the whole point is picking something), so
  // this starts open — the point of wrapping in Collapsible is giving the fleet list a
  // minimize control once it gets long, not hiding it up front.
  defaultOpen?: boolean;
}) {
  const [hostFilter, setHostFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");

  const hostTerm = hostFilter.trim().toLowerCase();
  const userTerm = userFilter.trim().toLowerCase();
  const filteredAgents = (agents ?? [])
    .filter((a) => !hostTerm || a.hostname.toLowerCase().includes(hostTerm))
    .filter((a) => !userTerm || (a.inventory?.lastLoggedOnUser ?? "").toLowerCase().includes(userTerm));

  const selectedGroupIdSet = new Set(selectedGroupIds ?? []);
  function impliedByGroup(agent: AgentListItem): boolean {
    return selectedGroupIdSet.size > 0 && agent.groups.some((g) => selectedGroupIdSet.has(g.id));
  }

  return (
    <Collapsible title={legend} defaultOpen={defaultOpen}>
      {agents && agents.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "0.5rem" }}>
          <label style={{ display: "inline-block" }}>
            Filter by host
            <input type="text" value={hostFilter} onChange={(e) => setHostFilter(e.target.value)} placeholder="Hostname…" />
          </label>
          <label style={{ display: "inline-block" }}>
            Filter by user
            <input type="text" value={userFilter} onChange={(e) => setUserFilter(e.target.value)} placeholder="Logged-on user…" />
          </label>
        </div>
      )}
      {filteredAgents.map((agent) => {
        const manuallySelected = selectedAgentIds.includes(agent.id);
        const implied = !manuallySelected && impliedByGroup(agent);
        return (
          <label key={agent.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={manuallySelected || implied}
              disabled={implied}
              title={implied ? "Already included via a selected group" : undefined}
              onChange={() => onToggle(agent.id)}
            />
            {renderRow ? (
              renderRow(agent)
            ) : (
              <>
                <EndpointLabel hostname={agent.hostname} agentId={agent.id} /> {renderExtra?.(agent)}
              </>
            )}
            {implied && <span style={{ color: "var(--text-muted)", fontSize: "0.85em" }}> (via group)</span>}
          </label>
        );
      })}
      {agents && agents.length === 0 && <p>{emptyMessage}</p>}
      {agents && agents.length > 0 && filteredAgents.length === 0 && <p>No endpoints match this filter.</p>}
    </Collapsible>
  );
}
