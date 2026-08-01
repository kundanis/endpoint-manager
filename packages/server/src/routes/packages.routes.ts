import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Router } from "express";
import multer from "multer";
import { packageMetadataSchema } from "@em/shared";
import { config } from "../config";
import { deletePackage, listPackages, uploadPackage } from "../services/package.service";

export const packagesRouter = Router();

fs.mkdirSync(config.uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB — generous ceiling for installer payloads
});

packagesRouter.post("/", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Missing file" });

    const metadata = packageMetadataSchema.parse(req.body);
    const result = await uploadPackage({
      metadata,
      uploadedByAdminId: req.adminId!,
      savedFilePath: req.file.path,
      originalFilename: req.file.originalname,
      fileSizeBytes: req.file.size,
    });
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

packagesRouter.get("/", async (_req, res, next) => {
  try {
    res.json(await listPackages());
  } catch (err) {
    next(err);
  }
});

packagesRouter.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await deletePackage(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Package not found" });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});
