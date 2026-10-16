import { useEffect, useState } from "react";
import type { RequiredSoftwareRequest, SecurityProductChoice } from "@em/shared";
import type { SecurityProductOption, ZeroTrustConditionView } from "../api/types";
import { Field, FormGrid } from "./ui";

// Picks the antivirus a Zero Trust policy requires and the endpoint-management agent it
// requires (or "don't check"), from the server's catalogue or any other product name.
// Used by "Add built-in policy" and by each policy's Required software tab.

const OTHER = "__other";
const NONE = "__none";

interface Selection {
  option: string; // catalogue id, OTHER or NONE
  otherName: string;
}

function toChoice(sel: Selection, options: SecurityProductOption[]): SecurityProductChoice | null {
  if (sel.option === NONE) return null;
  if (sel.option === OTHER) {
    const name = sel.otherName.trim();
    return name.length >= 2 ? { name, match: [name] } : null;
  }
  const o = options.find((x) => x.id === sel.option);
  return o ? { name: o.label, match: o.match } : null;
}

// Recovers the current choice from a policy's existing condition (its title carries the name).
function fromCondition(
  condition: ZeroTrustConditionView | undefined,
  prefix: string,
  suffix: string,
  options: SecurityProductOption[],
  fallback: string,
): Selection {
  if (!condition) return { option: fallback, otherName: "" };
  const name = condition.title.startsWith(prefix) && condition.title.endsWith(suffix)
    ? condition.title.slice(prefix.length, condition.title.length - suffix.length)
    : "";
  const known = options.find((o) => o.label === name);
  if (known) return { option: known.id, otherName: "" };
  return { option: OTHER, otherName: name };
}

export const AV_TITLE = { prefix: "Antivirus: ", suffix: " is registered with Windows Security Center" };
export const AGENT_TITLE = { prefix: "Management agent: ", suffix: " is installed" };

export function useRequiredSoftwareState(
  catalogue: { antivirus: SecurityProductOption[]; managementAgents: SecurityProductOption[] } | undefined,
  conditions?: ZeroTrustConditionView[],
) {
  const [av, setAv] = useState<Selection>({ option: "defender", otherName: "" });
  const [agent, setAgent] = useState<Selection>({ option: NONE, otherName: "" });

  useEffect(() => {
    if (!catalogue || !conditions) return;
    setAv(
      fromCondition(
        conditions.find((c) => c.conditionKey === "antivirus-registered"),
        AV_TITLE.prefix,
        AV_TITLE.suffix,
        catalogue.antivirus,
        NONE,
      ),
    );
    setAgent(
      fromCondition(
        conditions.find((c) => c.conditionKey === "management-agent-installed"),
        AGENT_TITLE.prefix,
        AGENT_TITLE.suffix,
        catalogue.managementAgents,
        NONE,
      ),
    );
  }, [catalogue, conditions]);

  const request: RequiredSoftwareRequest | null = catalogue
    ? { antivirus: toChoice(av, catalogue.antivirus), managementAgent: toChoice(agent, catalogue.managementAgents) }
    : null;
  // "Other" chosen but no name typed yet.
  const incomplete = (av.option === OTHER && av.otherName.trim().length < 2) || (agent.option === OTHER && agent.otherName.trim().length < 2);

  return { av, setAv, agent, setAgent, request, incomplete };
}

function ProductSelect({
  id,
  label,
  help,
  options,
  value,
  onChange,
  allowNone,
  noneLabel,
}: {
  id: string;
  label: string;
  help: string;
  options: SecurityProductOption[];
  value: Selection;
  onChange: (next: Selection) => void;
  allowNone: boolean;
  noneLabel: string;
}) {
  return (
    <>
      <Field label={label} htmlFor={id} help={help}>
        <select id={id} className="ep-select" value={value.option} onChange={(e) => onChange({ ...value, option: e.target.value })}>
          {allowNone && <option value={NONE}>{noneLabel}</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
          <option value={OTHER}>Other (type the product name)…</option>
        </select>
      </Field>
      {value.option === OTHER && (
        <Field label="Product name" htmlFor={`${id}-other`} help="Matched against the installed product's name, ignoring case - part of the name is enough.">
          <input
            id={`${id}-other`}
            className="ep-input"
            type="text"
            maxLength={100}
            value={value.otherName}
            onChange={(e) => onChange({ ...value, otherName: e.target.value })}
            placeholder="e.g. Cylance"
            data-autofocus
          />
        </Field>
      )}
    </>
  );
}

export function RequiredSoftwareFields({
  catalogue,
  state,
}: {
  catalogue: { antivirus: SecurityProductOption[]; managementAgents: SecurityProductOption[] };
  state: ReturnType<typeof useRequiredSoftwareState>;
}) {
  return (
    <FormGrid>
      <ProductSelect
        id="zt-required-av"
        label="Required antivirus"
        help="Must be registered with Windows Security Center on the endpoint."
        options={catalogue.antivirus}
        value={state.av}
        onChange={state.setAv}
        allowNone
        noneLabel="Don't check the antivirus"
      />
      <ProductSelect
        id="zt-required-agent"
        label="Required management agent"
        help="Must appear in the endpoint's installed programs."
        options={catalogue.managementAgents}
        value={state.agent}
        onChange={state.setAgent}
        allowNone
        noneLabel="Don't check a management agent"
      />
    </FormGrid>
  );
}
