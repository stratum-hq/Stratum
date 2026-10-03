import React, { useEffect, useId, useRef, useState } from "react";

export interface ConfirmActionProps {
  /** Text of the button that starts the action. */
  label: string;
  /** The question the user answers before the action runs, for example "Remove max_users?". */
  prompt: string;
  /** Text of the button that runs the action. */
  confirmLabel: string;
  /** Text of the button that stops the action. */
  cancelLabel: string;
  /** Runs the action. Report failures inside it; this component does not catch them. */
  onConfirm: () => Promise<void> | void;
}

/**
 * Return a button that runs a destructive action only after a second, explicit click.
 *
 * The first click replaces the button with the prompt and two choices, and moves focus
 * to the cancel choice, so a second Enter keypress cannot destroy data by accident.
 * Escape or the cancel choice restores the button and moves focus back to it.
 */
export function ConfirmAction({ label, prompt, confirmLabel, cancelLabel, onConfirm }: ConfirmActionProps) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const promptId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Focus returns to the trigger only after the user backs out, not on first render.
  const restoreFocus = useRef(false);

  useEffect(() => {
    if (armed) {
      cancelRef.current?.focus();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [armed]);

  const cancel = () => {
    restoreFocus.current = true;
    setArmed(false);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      // A successful action usually removes the row and this component with it.
      // When the row stays (the action failed), the user gets the button back.
      setBusy(false);
      cancel();
    }
  };

  if (!armed) {
    return (
      <button ref={triggerRef} type="button" onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }

  return (
    <span
      className="stratum-confirm"
      role="group"
      aria-labelledby={promptId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      }}
    >
      <span id={promptId} className="stratum-confirm__prompt">{prompt}</span>
      <button type="button" className="stratum-confirm__yes" onClick={confirm} disabled={busy}>
        {confirmLabel}
      </button>
      <button ref={cancelRef} type="button" onClick={cancel} disabled={busy}>
        {cancelLabel}
      </button>
    </span>
  );
}
