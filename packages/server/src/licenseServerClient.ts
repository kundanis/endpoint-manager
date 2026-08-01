import fs from "node:fs";
import https from "node:https";
import axios, { type AxiosInstance } from "axios";
import { config } from "./config";

// Same narrow "trust one specific cert" pattern as the agent's httpClient.ts — only set
// when a dev/test self-signed License Server certificate is configured. undefined means
// "rely on the default public CA trust store", the normal case for a real deployment.
const httpsAgent = config.licenseServerCaPath
  ? new https.Agent({ ca: fs.readFileSync(config.licenseServerCaPath) })
  : undefined;

// Built per-call, not once at module load — the License Server's address is a runtime,
// admin-configured setting (see licenseServerConfig.service.ts), so it can change without
// a restart. Cheap enough (no connection pooling lost — axios/Node's http agent pooling is
// keyed by host anyway) that there's no real cost to not caching this.
export function buildLicenseServerClient(baseUrl: string): AxiosInstance {
  return axios.create({
    baseURL: baseUrl,
    timeout: 15_000,
    httpsAgent,
  });
}
