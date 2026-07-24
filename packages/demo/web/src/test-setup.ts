import "@testing-library/jest-dom/vitest";

// Node >= 22 defines built-in `localStorage`/`sessionStorage` globals that stay inert
// unless the process was started with `--localstorage-file`. Vitest's jsdom environment
// only copies window properties that are not already present on globalThis, so on those
// Node versions jsdom's real Storage never lands and `localStorage.clear()` throws.
// Install an in-memory Storage when the ambient global is unusable. This is a no-op on
// Node 20, where jsdom's own Storage comes through untouched.
function installMemoryStorage(name: "localStorage" | "sessionStorage"): void {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(String(key)) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(String(key), String(value));
    },
    removeItem: (key: string) => {
      entries.delete(String(key));
    },
    clear: () => {
      entries.clear();
    },
  };
  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  if (typeof globalThis[name]?.clear !== "function") {
    installMemoryStorage(name);
  }
}
