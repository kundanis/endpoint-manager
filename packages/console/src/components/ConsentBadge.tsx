import type { EndpointConsentView } from "../api/types";
import { Badge } from "./ui";

// Endpoint user consent (DPDP) next to Online/Offline: Active once every signed-in user agreed,
// Consent pending until they answer, Inactive when someone declined. Nothing when consent isn't asked.
export default function ConsentBadge({ consent }: { consent: EndpointConsentView | null | undefined }) {
  if (!consent?.state || consent.state === "NOT_REQUIRED") return null;
  if (consent.needsAgentUpdate) {
    return (
      <span title="This endpoint's agent is older than the consent form (Windows agent 0.2.36). Update it under Agent Updates; until then its users can't be asked.">
        <Badge tone="neu">Consent: update agent</Badge>
      </span>
    );
  }
  const who = consent.users.map((u) => `${u.account}: ${u.decision === "AGREED" ? "agreed" : u.decision === "DECLINED" ? "declined" : "not answered"}`).join("\n");
  if (consent.state === "ACTIVE") {
    return (
      <span title={`Every signed-in user agreed to the consent notice.\n${who}`}>
        <Badge tone="ok">Active</Badge>
      </span>
    );
  }
  if (consent.state === "DECLINED") {
    return (
      <span title={`A signed-in user declined consent: no monitoring data is collected from this endpoint. Security policies still apply.\n${who}`}>
        <Badge tone="neu">Inactive</Badge>
      </span>
    );
  }
  return (
    <span title={`Waiting for the signed-in user to answer the consent notice in the Endpoint IQ tray app. No monitoring data is collected until then.${who ? `\n${who}` : ""}`}>
      <Badge tone="med">Consent pending</Badge>
    </span>
  );
}
