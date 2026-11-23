import fs from "node:fs";
import path from "node:path";
import { agentConfig } from "./config";
import { addLogSecret } from "./fileLog";

interface AgentState {
  agentId: string;
  apiKey: string;
}

const stateFilePath = () => path.join(agentConfig.stateDir, "state.json");

export function loadState(): AgentState | null {
  try {
    const raw = fs.readFileSync(stateFilePath(), "utf-8");
    const state = JSON.parse(raw) as AgentState;
    addLogSecret(state.apiKey); // never written to a log, wherever it turns up
    return state;
  } catch {
    return null;
  }
}

export function saveState(state: AgentState): void {
  addLogSecret(state.apiKey);
  fs.mkdirSync(agentConfig.stateDir, { recursive: true });
  fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
}
