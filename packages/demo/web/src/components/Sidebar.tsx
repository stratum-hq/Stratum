import React, { useEffect, useRef, useState } from "react";
import { DraggableTenantTree, useStratum, useTenant } from "@stratum-hq/react";

// The legend names the first three rock bands, which the tree uses for depth 0 to 2.
const LEGEND = [
  { label: "MSSP", band: "var(--stratum-tree-band-0)" },
  { label: "MSP", band: "var(--stratum-tree-band-1)" },
  { label: "Client", band: "var(--stratum-tree-band-2)" },
];

type Task =
  | { kind: "create"; parentId: string | null }
  | { kind: "rename"; id: string; name: string }
  | { kind: "archive"; id: string; name: string };

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" fill="none" />
    </svg>
  );
}

/**
 * Return the form for one tenant task: create, rename or archive.
 *
 * The form replaces the browser's prompt and confirm dialogs. Escape or Cancel
 * ends the task without a request.
 */
function TenantTaskForm({
  task,
  onDone,
  onCancel,
}: {
  task: Task;
  onDone: (createdId?: string) => void;
  onCancel: () => void;
}) {
  const { apiCall } = useStratum();
  const [name, setName] = useState(task.kind === "rename" ? task.name : "");
  const [slug, setSlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  // The safe choice gets focus first, so a second Enter cannot archive by accident.
  useEffect(() => {
    if (task.kind === "archive") keepRef.current?.focus();
  }, [task.kind]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (task.kind === "create") {
        const created = await apiCall<{ id: string }>("/api/v1/tenants", {
          method: "POST",
          body: JSON.stringify({
            name: name.trim(),
            slug: slug.trim(),
            isolation_strategy: "SHARED_RLS",
            ...(task.parentId ? { parent_id: task.parentId } : {}),
          }),
        });
        onDone(created.id);
      } else if (task.kind === "rename") {
        await apiCall(`/api/v1/tenants/${encodeURIComponent(task.id)}`, {
          method: "PATCH",
          body: JSON.stringify({ name: name.trim() }),
        });
        onDone();
      } else {
        await apiCall(`/api/v1/tenants/${encodeURIComponent(task.id)}`, { method: "DELETE" });
        onDone();
      }
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  const title =
    task.kind === "create"
      ? task.parentId ? "New child tenant" : "New root tenant"
      : task.kind === "rename"
        ? `Rename ${task.name}`
        : `Archive ${task.name}?`;

  const canSubmit =
    task.kind === "archive" ||
    (task.kind === "create" ? name.trim() !== "" && slug.trim() !== "" : name.trim() !== "" && name.trim() !== task.name);

  return (
    <form
      className="demo-tenant-form"
      aria-label={title}
      onSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className="demo-form-title">{title}</p>
      {task.kind === "archive" ? (
        <p className="demo-form-note">Archiving soft-deletes the tenant.</p>
      ) : (
        <>
          <div>
            <label className="demo-label" htmlFor="tenant-name">Name</label>
            <input
              id="tenant-name"
              className="demo-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          {task.kind === "create" && (
            <div>
              <label className="demo-label" htmlFor="tenant-slug">Slug</label>
              <input
                id="tenant-slug"
                className="demo-input"
                placeholder="lowercase_with_underscores"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
              />
            </div>
          )}
        </>
      )}
      {error && <p className="demo-error" role="alert">Error: {error}</p>}
      <div className="demo-form-actions">
        <button
          type="submit"
          className={task.kind === "archive" ? "demo-button demo-button--danger" : "demo-button demo-button--flow"}
          disabled={busy || !canSubmit}
        >
          {task.kind === "create" ? "Create" : task.kind === "rename" ? "Rename" : "Archive"}
        </button>
        <button ref={keepRef} type="button" className="demo-button" onClick={onCancel} disabled={busy}>
          {task.kind === "archive" ? "Keep" : "Cancel"}
        </button>
      </div>
    </form>
  );
}

export function Sidebar({
  onClose,
  onTenantSelect,
}: {
  /** Closes the drawer. Absent when the panel is not a drawer. */
  onClose?: () => void;
  /** Runs after the user picks a tenant in the tree. */
  onTenantSelect?: () => void;
}) {
  const { switchTenant } = useTenant();
  const [task, setTask] = useState<Task | null>(null);
  // The tree loads its own data. A new key remounts it, so it reloads after a change.
  const [treeVersion, setTreeVersion] = useState(0);
  const returnFocus = useRef<HTMLElement | null>(null);

  const startTask = (next: Task) => {
    returnFocus.current = document.activeElement as HTMLElement | null;
    setTask(next);
  };

  const cancelTask = () => {
    setTask(null);
    returnFocus.current?.focus();
  };

  const finishTask = (createdId?: string) => {
    setTask(null);
    setTreeVersion((v) => v + 1);
    if (createdId) void switchTenant(createdId);
  };

  return (
    <aside className="demo-sidebar" aria-label="Tenants">
      <div className="demo-sidebar-header">
        <div>
          <h2 className="demo-sidebar-title">Tenant hierarchy</h2>
          <ul className="demo-legend" aria-label="Depth colors">
            {LEGEND.map((item) => (
              <li key={item.label}>
                <span className="demo-swatch" style={{ background: item.band }} />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
        {onClose && (
          <button type="button" className="demo-icon-button" onClick={onClose} aria-label="Close tenant list">
            <CloseIcon />
          </button>
        )}
      </div>

      <div className="demo-sidebar-tree">
        <DraggableTenantTree
          key={treeVersion}
          onSelect={(id) => {
            void switchTenant(id);
            onTenantSelect?.();
          }}
          onAddChild={(parentId) => startTask({ kind: "create", parentId })}
          onEdit={(id, name) => startTask({ kind: "rename", id, name })}
          onArchive={(id, name) => startTask({ kind: "archive", id, name })}
        />
      </div>

      <div className="demo-sidebar-footer">
        {task ? (
          <TenantTaskForm
            key={task.kind === "create" ? `create-${task.parentId}` : `${task.kind}-${task.id}`}
            task={task}
            onDone={finishTask}
            onCancel={cancelTask}
          />
        ) : (
          <button
            type="button"
            className="demo-button"
            onClick={() => startTask({ kind: "create", parentId: null })}
          >
            Add root tenant
          </button>
        )}
      </div>
    </aside>
  );
}
