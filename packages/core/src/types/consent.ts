import { z } from "zod";

export const ConsentPurpose = {
  DATA_PROCESSING: "data_processing",
  ANALYTICS: "analytics",
  MARKETING: "marketing",
  THIRD_PARTY_SHARING: "third_party_sharing",
} as const;

export const ConsentRecordSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  subject_id: z.string(),
  purpose: z.string(),
  granted: z.boolean(),
  granted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const GrantConsentInputSchema = z.object({
  subject_id: z.string().min(1),
  purpose: z.string().min(1),
  expires_at: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type GrantConsentInput = z.infer<typeof GrantConsentInputSchema>;
