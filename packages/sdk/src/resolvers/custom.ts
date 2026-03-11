export interface TenantResolver {
  resolve(req: unknown): string | null | Promise<string | null>;
}
