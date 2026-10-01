// Browser replacement for `node:async_hooks`. The store lives only for the
// synchronous part of run(), so it is lost after the first await. The
// Playground does not call the library's AsyncLocalStorage methods.
export class AsyncLocalStorage<T> {
  private store: T | undefined;

  getStore(): T | undefined {
    return this.store;
  }

  run<R>(store: T, fn: (...args: unknown[]) => R, ...args: unknown[]): R {
    const previous = this.store;
    this.store = store;
    try {
      return fn(...args);
    } finally {
      this.store = previous;
    }
  }

  enterWith(store: T): void {
    this.store = store;
  }
}
