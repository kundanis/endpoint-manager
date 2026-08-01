import https from "node:https";
import axios from "axios";
import { agentConfig } from "./config";

// Only set when a dev/test self-signed cert is configured (see config.ts's
// readServerCaPem) — trusts that one specific certificate in addition to the OS's public
// CA store. undefined here just means "rely on the default trust store", exactly as before.
const httpsAgent = agentConfig.serverCaPem ? new https.Agent({ ca: agentConfig.serverCaPem }) : undefined;

export const publicClient = axios.create({
  baseURL: agentConfig.serverUrl,
  timeout: 15_000,
  httpsAgent,
});

export function agentClient(agentId: string, apiKey: string) {
  return axios.create({
    baseURL: agentConfig.serverUrl,
    timeout: 15_000,
    httpsAgent,
    headers: {
      "X-Agent-Id": agentId,
      "X-Agent-Key": apiKey,
    },
  });
}
