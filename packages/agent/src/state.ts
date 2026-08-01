import fs from "node:fs";
import path from "node:path";
import { agentConfig } from "./config";

interface AgentState {
  agentId: string;
  apiKey: string;
}

const stateFilePath = () => path.join(agentConfig.stateDir, "state.json");

export function loadState(): AgentState | null {
  try {
    const raw = fs.readFileSync(stateFilePath(), "utf-8");
    return JSON.parse(raw) as AgentState;
  } catch {
    return null;
  }
}

export function saveState(state: AgentState): void {
  fs.mkdirSync(agentConfig.stateDir, { recursive: true });
  fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
}
