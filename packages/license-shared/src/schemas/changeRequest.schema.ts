import { z } from "zod";
import { licenseModuleSchema, validityTypeSchema } from "./common.schema";
import { licenseFeatureListSchema } from "../features";

// Licence change requests. An activated deployment never polls the License Server: when the
// vendor changes an activated key (adds a module, more endpoints, a different end date), the
// License Server PUSHES a request to the deployment, whose admin accepts or rejects it there.
//
// - ADDITION (only gains): nothing changes unless the customer accepts.
// - REDUCTION (anything removed or lowered): the customer can accept or reject (the reason
//   goes back to the vendor), but it applies by itself at autoApplyAt either way - both sides
//   apply it on their own at that time, so neither has to reach the other.
// - Revocation is not a request: it still applies at once (revokeNotice.schema.ts).
//
// The pushed copy is only ever used to SHOW the request (and to apply a reduction at its
// deadline, after the deployment has checked it really only reduces). Accepting fetches the
// resulting terms from the License Server with the deployment's binding proof, so a forged
// push can never grant anything.

export const licenseTermsSchema = z.object({
  maxAgents: z.number().int().positive(),
  validityType: validityTypeSchema,
  validUntil: z.string().nullable(), // ISO date-time; null = perpetual
  modules: z.array(licenseModuleSchema),
  // Features within the modules (features.ts); null or absent = everything in them.
  features: licenseFeatureListSchema.optional(),
});
export type LicenseTerms = z.infer<typeof licenseTermsSchema>;

export const LICENSE_CHANGE_KINDS = ["ADDITION", "REDUCTION"] as const;
export type LicenseChangeKind = (typeof LICENSE_CHANGE_KINDS)[number];

export const LICENSE_CHANGE_STATUSES = ["PENDING", "ACCEPTED", "REJECTED", "AUTO_APPLIED", "CANCELLED"] as const;
export const licenseChangeStatusSchema = z.enum(LICENSE_CHANGE_STATUSES);
export type LicenseChangeStatus = z.infer<typeof licenseChangeStatusSchema>;

// Days a customer has to accept a reduction before it applies by itself.
export const REDUCTION_AUTO_APPLY_DAYS = 15;

export const licenseChangeRequestWireSchema = z.object({
  id: z.string().min(1).max(100),
  kind: z.enum(LICENSE_CHANGE_KINDS),
  status: licenseChangeStatusSchema,
  message: z.string().max(1000).nullable(),
  current: licenseTermsSchema, // the licence when the request was made
  proposed: licenseTermsSchema,
  createdAt: z.string(),
  autoApplyAt: z.string().nullable(), // reductions only
});
export type LicenseChangeRequestWire = z.infer<typeof licenseChangeRequestWireSchema>;

// What the License Server POSTs to {callbackUrl}/api/license-callback/change-request - a new
// request, or a later state of one (cancelled by the vendor, applied at its deadline).
export const licenseChangeNoticeSchema = z.object({
  deploymentId: z.string().min(1).max(100),
  revocationSecret: z.string().min(1).max(200),
  request: licenseChangeRequestWireSchema,
});
export type LicenseChangeNotice = z.infer<typeof licenseChangeNoticeSchema>;

export const LICENSE_CHANGE_NOTICE_PATH = "/api/license-callback/change-request";

// Deployment -> License Server, with the same binding proof as /register-callback.
const bindingProof = {
  keyString: z.string().min(1).max(64),
  deploymentId: z.string().min(1).max(100),
  bindingToken: z.string().min(1),
};

export const respondToLicenseChangeRequestSchema = z.object({
  ...bindingProof,
  requestId: z.string().min(1).max(100),
  decision: z.enum(["ACCEPT", "REJECT"]),
  reason: z.string().max(1000).optional(),
});
export type RespondToLicenseChangeRequest = z.infer<typeof respondToLicenseChangeRequestSchema>;

export const respondToLicenseChangeResponseSchema = z.object({
  request: licenseChangeRequestWireSchema,
  // The key's terms after the answer, straight from the License Server - what an accepting
  // deployment applies.
  terms: licenseTermsSchema,
});
export type RespondToLicenseChangeResponse = z.infer<typeof respondToLicenseChangeResponseSchema>;

// "Check for licence requests" on a deployment the License Server couldn't reach: a one-off
// fetch when the admin asks, never a schedule.
export const pendingLicenseChangesRequestSchema = z.object(bindingProof);
export type PendingLicenseChangesRequest = z.infer<typeof pendingLicenseChangesRequestSchema>;

export const pendingLicenseChangesResponseSchema = z.object({
  requests: z.array(licenseChangeRequestWireSchema),
});
export type PendingLicenseChangesResponse = z.infer<typeof pendingLicenseChangesResponseSchema>;
