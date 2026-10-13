import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import type { AgentListItem } from "../api/types";
import EndpointLabel from "./EndpointLabel";

// Shared "pick endpoints" checklist — used by every "Assign to" / "Target endpoints"
// panel across the console (policy assignment pages, command/patch/package/agent-update
// dispatch). Shows the logged-on user next to each hostname, filters by host or user once
// the fleet gets large, can be minimized so a long fleet doesn't dominate the page, and
// (via `selectedGroupIds`) shows which hosts are already covered by a currently-selected
// group so it's obvious they don't need picking individually too.
//
// Rendered as a bordered picker block (not a card) so it nests inside cards and forms.
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
  defaultOpen?: boolean;
}) {
  const [hostFilter, setHostFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [open, setOpen] = useState(defaultOpen);

  const hostTerm = hostFilter.trim().toLowerCase();
  const userTerm = userFilter.trim().toLowerCase();
  const filteredAgents = (agents ?? [])
    .filter((a) => !hostTerm || a.hostname.toLowerCase().includes(hostTerm))
    .filter((a) => !userTerm || (a.inventory?.lastLoggedOnUser ?? "").toLowerCase().includes(userTerm));

  const selectedGroupIdSet = new Set(selectedGroupIds ?? []);
  function impliedByGroup(agent: AgentListItem): boolean {
    return selectedGroupIdSet.size > 0 && agent.groups.some((g) => selectedGroupIdSet.has(g.id));
  }

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div className="app-picker">
      <button type="button" className="app-picker-head" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Chevron size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
        <span className="app-picker-title">{legend}</span>
        <span className="app-picker-count ep-num">
          {selectedAgentIds.length > 0 ? `${selectedAgentIds.length} selected` : `${agents?.length ?? 0} available`}
        </span>
      </button>
      {open && (
        <>
          {agents && agents.length > 0 && (
            <div className="app-picker-filters">
              <div className="ep-input-icon">
                <Search size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
                <input
                  type="search"
                  className="ep-input"
                  value={hostFilter}
                  onChange={(e) => setHostFilter(e.target.value)}
                  placeholder="Filter by hostname…"
                  aria-label="Filter by hostname"
                />
              </div>
              <div className="ep-input-icon">
                <Search size={16} strokeWidth={1.7} className="ep-ic" aria-hidden />
                <input
                  type="search"
                  className="ep-input"
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  placeholder="Filter by logged-on user…"
                  aria-label="Filter by logged-on user"
                />
              </div>
            </div>
          )}
          <div className="app-picker-list">
            {filteredAgents.map((agent) => {
              const manuallySelected = selectedAgentIds.includes(agent.id);
              const implied = !manuallySelected && impliedByGroup(agent);
              return (
                <label key={agent.id} className="ep-check app-picker-row">
                  <input
                    type="checkbox"
                    checked={manuallySelected || implied}
                    disabled={implied}
                    title={implied ? "Already included via a selected group" : undefined}
                    onChange={() => onToggle(agent.id)}
                  />
                  <span>
                    {renderRow ? (
                      renderRow(agent)
                    ) : (
                      <>
                        <EndpointLabel hostname={agent.hostname} agentId={agent.id} /> {renderExtra?.(agent)}
                      </>
                    )}
                    {implied && <span className="app-picker-implied"> · via group</span>}
                  </span>
                </label>
              );
            })}
            {agents && agents.length === 0 && <span className="ep-nodata">{emptyMessage}</span>}
            {agents && agents.length > 0 && filteredAgents.length === 0 && (
              <span className="ep-nodata">No endpoints match this filter.</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
