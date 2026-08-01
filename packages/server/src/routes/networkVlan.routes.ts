import { Router } from "express";
import { createNetworkVlanRequestSchema, updateNetworkVlanRequestSchema } from "@em/shared";
import { InvalidCidrError, ScanAlreadyRunningError, listScanRuns } from "../services/networkScan.service";
import {
  VlanNotFoundError,
  createVlan,
  deleteVlan,
  getNetworkDeviceSummary,
  getVlan,
  listVlans,
  scanAllEnabledVlans,
  triggerVlanScan,
  updateVlan,
} from "../services/networkVlan.service";

export const networkVlanRouter = Router();

networkVlanRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listVlans());
  } catch (err) {
    next(err);
  }
});

networkVlanRouter.post("/", async (req, res, next) => {
  try {
    const payload = createNetworkVlanRequestSchema.parse(req.body);
    const vlan = await createVlan({ ...payload, createdByAdminId: req.adminId! });
    res.status(201).json(vlan);
  } catch (err) {
    if (err instanceof InvalidCidrError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

// Registered before the /:id routes below — otherwise "device-summary" would be
// swallowed as an :id param value.
networkVlanRouter.get("/device-summary", async (_req, res, next) => {
  try {
    res.json(await getNetworkDeviceSummary());
  } catch (err) {
    next(err);
  }
});

networkVlanRouter.get("/:id", async (req, res, next) => {
  try {
    const vlan = await getVlan(req.params.id);
    if (!vlan) return res.status(404).json({ error: "VLAN not found" });
    res.json(vlan);
  } catch (err) {
    next(err);
  }
});

networkVlanRouter.patch("/:id", async (req, res, next) => {
  try {
    const payload = updateNetworkVlanRequestSchema.parse(req.body);
    const vlan = await updateVlan(req.params.id, payload);
    res.json(vlan);
  } catch (err) {
    if (err instanceof VlanNotFoundError) return res.status(404).json({ error: "VLAN not found" });
    if (err instanceof InvalidCidrError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

networkVlanRouter.delete("/:id", async (req, res, next) => {
  try {
    await deleteVlan(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

networkVlanRouter.get("/:id/scan-runs", async (req, res, next) => {
  try {
    res.json(await listScanRuns({ vlanId: req.params.id }));
  } catch (err) {
    next(err);
  }
});

networkVlanRouter.post("/:id/scan-now", async (req, res, next) => {
  try {
    const result = await triggerVlanScan(req.params.id, req.adminId!);
    res.status(202).json(result);
  } catch (err) {
    if (err instanceof VlanNotFoundError) return res.status(404).json({ error: "VLAN not found" });
    if (err instanceof ScanAlreadyRunningError) {
      return res.status(409).json({ error: err.message, runId: err.runId });
    }
    if (err instanceof InvalidCidrError) return res.status(400).json({ error: err.message });
    next(err);
  }
});

networkVlanRouter.post("/scan-all-enabled", async (req, res, next) => {
  try {
    res.status(202).json(await scanAllEnabledVlans(req.adminId!));
  } catch (err) {
    next(err);
  }
});
