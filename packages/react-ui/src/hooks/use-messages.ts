import { useCallback } from "react";
import { useStratum } from "../provider.js";
import { defaultMessages, type MessageKey } from "../i18n.js";

/**
 * Returns a `t()` function that resolves message keys to localised strings.
 *
 * User-supplied messages (via `StratumProvider`) override `defaultMessages`.
 * Placeholders like `{param}` are replaced when a `params` record is provided.
 */
export function useMessages() {
  const { messages: userMessages } = useStratum();

  const t = useCallback(
    (key: MessageKey, params?: Record<string, string>): string => {
      let value: string = (userMessages as Record<string, string | undefined>)?.[key] ?? defaultMessages[key];
      if (params) {
        for (const [k, v] of Object.entries(params)) {
          value = value.replace(`{${k}}`, v);
        }
      }
      return value;
    },
    [userMessages],
  );

  return { t };
}
