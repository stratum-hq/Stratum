import { z } from "zod";

export const API_KEY_SCOPES = ["read", "write", "admin"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const ApiKeyScopeSchema = z.enum(API_KEY_SCOPES);
