import { Router } from "express";
import { startNetworkScanRequestSchema } from "@em/shared";
import {
  InvalidCidrError,
  ScanAlreadyRunningError,
  getScanRun,
  getSuggestedCidr,
  listScanRuns,
  startScan,
} from "../services/networkScan.service";
import { VlanNotFoundError, triggerVlanScan } from "../services/networkVlan.service";

export const networkScanRouter = Router();

networkScanRouter.get("/suggested-cidr", (_req, res) => {
  res.json({ cidr: getSuggestedCidr() });
});

networkScanRouter.post("/", async (req, res, next) => {
  try {
    const payload = startNetworkScanRequestSchema.parse(req.body);
    // vlanId present => delegate to the same VLAN-aware trigger the dedicated
    // /admin/network-vlans/:id/scan-now route uses; cidr is ignored in that case.
    const result = payload.vlanId
      ? await triggerVlanScan(payload.vlanId, req.adminId!)
      : await startScan(payload.cidr, req.adminId!);
    res.status(202).json(result);
  } catch (err) {
    if (err instanceof VlanNotFoundError) return res.status(404).json({ error: "VLAN not found" });
    if (err instanceof ScanAlreadyRunningError) {
      return res.status(409).json({ error: err.message, runId: err.runId });
    }
    if (err instanceof InvalidCidrError) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

networkScanRouter.get("/", async (req, res, next) => {
  try {
    // ?vlanId=none => only legacy/manual runs that predate this feature (vlanId IS NULL) —
    // used by the console's "no VLAN" section, distinct from omitting the param entirely.
    const filter = req.query.vlanId === "none" ? { vlanId: null } : undefined;
    res.json(await listScanRuns(filter));
  } catch (err) {
    next(err);
  }
});

networkScanRouter.get("/:id", async (req, res, next) => {
  try {
    const run = await getScanRun(req.params.id);
    if (!run) return res.status(404).json({ error: "Scan run not found" });
    res.json(run);
  } catch (err) {
    next(err);
  }
});
