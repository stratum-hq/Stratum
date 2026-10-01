// Browser replacement for Node modules that the library imports but the
// Playground never calls: the file system, DNS and HTTP for webhook delivery.
// Any use fails with a clear message instead of a missing-function error.
const unavailable: Record<string, unknown> = new Proxy(
  {},
  {
    get(_target, name) {
      if (typeof name === "symbol" || name === "__esModule" || name === "then") return undefined;
      return () => {
        throw new Error(`${name} is not available in the browser Playground`);
      };
    },
  },
);

export default unavailable;
