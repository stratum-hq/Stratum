import { z } from "zod";
import { UUIDSchema } from "../utils/validation.js";
import { hasTimestamptzYear, TIMESTAMPTZ_YEAR_MESSAGE } from "../utils/timestamptz.js";

export const ConsentPurpose = {
  DATA_PROCESSING: "data_processing",
  ANALYTICS: "analytics",
  MARKETING: "marketing",
  THIRD_PARTY_SHARING: "third_party_sharing",
} as const;

export const ConsentRecordSchema = z.object({
  id: UUIDSchema,
  tenant_id: UUIDSchema,
  subject_id: z.string(),
  purpose: z.string(),
  granted: z.boolean(),
  granted_at: z.string().nullable(),
  revoked_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  created_at: z.string(),
  updated_at: z.string(),
});

export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const GrantConsentInputSchema = z.object({
  subject_id: z.string().min(1),
  purpose: z.string().min(1),
  expires_at: z
    .string()
    .datetime({ offset: true })
    .refine(hasTimestamptzYear, TIMESTAMPTZ_YEAR_MESSAGE)
    .optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type GrantConsentInput = z.input<typeof GrantConsentInputSchema>;
