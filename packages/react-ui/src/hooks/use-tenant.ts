import { useStratum } from "../provider.js";

export function useTenant() {
  const { currentTenant, tenantContext, loading, error, switchTenant } = useStratum();
  return { tenant: currentTenant, context: tenantContext, loading, error, switchTenant };
}
