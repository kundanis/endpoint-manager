import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AgentListItem } from "../api/types";

// "HOSTNAME / user / group" wherever an endpoint is named in the console. Most views only
// carry a hostname (and usually an agentId), so the user/group come from the endpoints list
// rather than from every individual API. Shares useAgents()'s ["agents"] cache, but polls at
// 60s instead of its 5s - often enough that the online/offline dots don't go stale on pages
// that merely label endpoints, without those pages hammering the full inventory list.
function useEndpointDirectory() {
  const { data } = useQuery({
    queryKey: ["agents"],
    queryFn: () => api.get<AgentListItem[]>("/admin/agents"),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  return useMemo(() => {
    const byId = new Map<string, AgentListItem>();
    const byHostname = new Map<string, AgentListItem | null>();
    for (const agent of data ?? []) {
      byId.set(agent.id, agent);
      const key = agent.hostname.toLowerCase();
      // A hostname shared by two records (re-enrolled duplicates) is ambiguous — don't guess.
      byHostname.set(key, byHostname.has(key) ? null : agent);
    }
    return { byId, byHostname };
  }, [data]);
}

function useEndpointAgent(hostname: string | null | undefined, agentId?: string | null): AgentListItem | null | undefined {
  const { byId, byHostname } = useEndpointDirectory();
  return (agentId ? byId.get(agentId) : undefined) ?? (hostname ? byHostname.get(hostname.toLowerCase()) : undefined);
}

export function useEndpointSuffix(
  hostname: string | null | undefined,
  agentId?: string | null,
  { hideUser = false }: { hideUser?: boolean } = {},
): string {
  const agent = useEndpointAgent(hostname, agentId);
  if (!agent) return "";
  const user = hideUser ? null : agent.inventory?.lastLoggedOnUser;
  const parts = [user, agent.groups.map((g) => g.name).join(", ")].filter(
    (p): p is string => !!p,
  );
  return parts.length > 0 ? ` / ${parts.join(" / ")}` : "";
}

// Green/red online indicator shown in front of every endpoint name. Renders nothing when the
// endpoint can't be resolved (unknown or ambiguous hostname) rather than guessing a state.
export function EndpointStatusDot({ hostname, agentId }: { hostname?: string | null; agentId?: string | null }) {
  const agent = useEndpointAgent(hostname, agentId);
  if (!agent) return null;
  const online = agent.status === "ONLINE";
  return (
    <span
      className={`endpoint-status-dot ${online ? "online" : "offline"}`}
      title={online ? "Online" : "Offline"}
      aria-label={online ? "Online" : "Offline"}
      role="img"
    />
  );
}

// <option> can only hold plain text, so drop-downs use this instead of <EndpointLabel> -
// the status dot becomes an emoji prefix.
export function EndpointOption({ value, hostname, agentId }: { value: string; hostname: string; agentId?: string | null }) {
  const agent = useEndpointAgent(hostname, agentId);
  const suffix = useEndpointSuffix(hostname, agentId);
  const dot = agent ? (agent.status === "ONLINE" ? "🟢 " : "🔴 ") : "";
  return <option value={value}>{dot + hostname + suffix}</option>;
}

export default function EndpointLabel({
  hostname,
  agentId,
  fallback = "—",
  hideUser = false,
}: {
  hostname: string | null | undefined;
  agentId?: string | null;
  fallback?: string;
  // For rows that already have their own User column — show only the group(s).
  hideUser?: boolean;
}) {
  const suffix = useEndpointSuffix(hostname, agentId, { hideUser });
  if (!hostname) return <>{fallback}</>;
  return (
    <>
      <EndpointStatusDot hostname={hostname} agentId={agentId} />
      {hostname}
      {suffix && <span className="endpoint-label-meta">{suffix}</span>}
    </>
  );
}
