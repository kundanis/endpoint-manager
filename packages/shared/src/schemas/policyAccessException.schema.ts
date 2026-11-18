import { z } from "zod";

// Spans every EPM module plus DLP — a policy type this exception can apply to. Mirrors the
// LICENSE_MODULES style of fixed string enum rather than a live cross-table FK, since a
// single column can't hold a foreign key into six different, unrelated policy tables.
export const POLICY_ACCESS_EXCEPTION_TYPES = [
  "APP_CONTROL",
  "WEB_BLOCK",
  "COMMAND_BLOCK",
  "IP_BLOCK",
  "USB_CONTROL",
  "DLP",
  "SCREENSHOT_BLOCK",
] as const;
export type PolicyAccessExceptionType = (typeof POLICY_ACCESS_EXCEPTION_TYPES)[number];

// Requests raised by the endpoint's own user from the Endpoint IQ tray app are stored as
// ordinary exception requests, with requestedByAdminId set to this prefix + the Windows
// account name (e.g. "endpoint-user:CORP\jane"). An admin approves or rejects them as usual.
export const ENDPOINT_USER_REQUESTER_PREFIX = "endpoint-user:";

// The durations an endpoint user can ask for (an admin can grant up to 7 days from the console).
export const ENDPOINT_PAUSE_DURATIONS_MINUTES = [15, 60, 240, 480, 1440] as const;

export const endpointPauseRequestSchema = z.object({
  items: z
    .array(z.object({ policyType: z.enum(POLICY_ACCESS_EXCEPTION_TYPES), policyId: z.string().min(1).max(100) }))
    .min(1)
    .max(20),
  durationMinutes: z.number().int().refine((m) => (ENDPOINT_PAUSE_DURATIONS_MINUTES as readonly number[]).includes(m), "Unsupported duration"),
  reason: z.string().trim().min(1).max(1000),
  requestedBy: z.string().trim().min(1).max(200),
});
export type EndpointPauseRequest = z.infer<typeof endpointPauseRequestSchema>;

// GET /api/agent/policies: the pausable EPM and DLP policies that apply to this endpoint.
export interface AgentApplicablePolicy {
  policyType: PolicyAccessExceptionType;
  policyId: string;
  name: string;
  area: "EPM" | "DLP";
  typeLabel: string;
  pausedUntil: string | null; // an approved pause is in effect until then
  pendingRequestId: string | null; // a pause request is waiting for an admin
}

// GET /api/agent/pause-requests: this endpoint's recent requests, newest first.
export interface AgentPauseRequestView {
  id: string;
  policyType: PolicyAccessExceptionType;
  policyName: string;
  durationMinutes: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "ENDED";
  isActive: boolean;
  expiresAt: string | null;
  resolutionNote: string | null;
  requestedBy: string | null; // the Windows account, for requests made from the endpoint
  createdAt: string;
}

// One endpoint (agentId) or every endpoint in a group (groupId) - a group request creates one
// request per endpoint, each approved, rejected or ended on its own.
export const createPolicyAccessExceptionRequestSchema = z
  .object({
    policyType: z.enum(POLICY_ACCESS_EXCEPTION_TYPES),
    policyId: z.string().min(1),
    agentId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    reason: z.string().min(1).max(1000),
    durationMinutes: z.number().int().positive().max(10080), // capped at 7 days
  })
  .refine((v) => !!v.agentId !== !!v.groupId, { message: "Choose an endpoint or a group", path: ["agentId"] });
export type CreatePolicyAccessExceptionRequest = z.infer<typeof createPolicyAccessExceptionRequestSchema>;

export const resolvePolicyAccessExceptionRequestSchema = z.object({
  resolutionNote: z.string().max(1000).nullable().optional(),
});
export type ResolvePolicyAccessExceptionRequest = z.infer<typeof resolvePolicyAccessExceptionRequestSchema>;
