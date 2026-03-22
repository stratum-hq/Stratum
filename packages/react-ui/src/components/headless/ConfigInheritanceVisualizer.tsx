/**
 * HeadlessConfigInheritanceVisualizer — render-prop version of the
 * config cascade visualizer. Provides data + state, you provide the UI.
 */

import type { ReactNode } from "react";
import { useConfigCascade } from "../../hooks/use-config-cascade.js";
import type { ConfigCascadeData } from "../../hooks/use-config-cascade.js";

export interface HeadlessConfigInheritanceVisualizerAPI {
  data: ConfigCascadeData | null;
  loading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export interface HeadlessConfigInheritanceVisualizerProps {
  children: (api: HeadlessConfigInheritanceVisualizerAPI) => ReactNode;
}

export function HeadlessConfigInheritanceVisualizer({
  children,
}: HeadlessConfigInheritanceVisualizerProps) {
  const api = useConfigCascade();
  return <>{children(api)}</>;
}
