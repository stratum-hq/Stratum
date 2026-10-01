// Browser replacement for `pg`. The library imports pg for its types and for
// constructors that the Playground never calls, because PGlite replaces the pool.
function unavailable(): never {
  throw new Error("pg is not available in the browser Playground; use the PGlite pool");
}

class Pool {
  constructor() {
    unavailable();
  }
}

class Client {
  constructor() {
    unavailable();
  }
}

const types = { setTypeParser() {}, getTypeParser: () => (value: string) => value };

export default { Pool, Client, types };
export { Pool, Client, types };
