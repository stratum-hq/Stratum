/**
 * Request headers that src/proxy.ts sets for Server Components.
 *
 * The proxy deletes any client-sent copy of these headers before it sets
 * them. A page that reads them therefore sees only values the proxy
 * derived from a verified token or from the host name.
 */
export const TENANT_ID_HEADER = "x-stratum-tenant-id";
export const TENANT_SLUG_HEADER = "x-stratum-tenant-slug";
