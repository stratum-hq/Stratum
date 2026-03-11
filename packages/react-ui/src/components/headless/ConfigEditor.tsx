import { useConfig, type ConfigWithInheritance } from "../../hooks/use-config.js";

export interface HeadlessConfigEditorAPI {
  config: ConfigWithInheritance[];
  loading: boolean;
  error: Error | null;
  setConfigValue: (key: string, value: unknown, locked?: boolean) => Promise<void>;
  deleteConfigValue: (key: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export interface HeadlessConfigEditorProps {
  children: (api: HeadlessConfigEditorAPI) => React.ReactNode;
}

export function HeadlessConfigEditor({ children }: HeadlessConfigEditorProps) {
  const { config, loading, error, setConfigValue, deleteConfigValue, refresh } = useConfig();

  return <>{children({ config, loading, error, setConfigValue, deleteConfigValue, refresh })}</>;
}
