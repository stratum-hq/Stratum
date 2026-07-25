import { describe, it, expect } from "vitest";
import { scopeSatisfies } from "../utils/scopes.js";

// The frozen scope contract: read < write < admin. A granted scope satisfies
// any required scope of equal-or-lower rank (admin implies write implies read).
// These are the exact cases a flat `includes` check would get wrong.

describe("scopeSatisfies", () => {
  it("admin satisfies read, write, and admin", () => {
    expect(scopeSatisfies(["admin"], "read")).toBe(true);
    expect(scopeSatisfies(["admin"], "write")).toBe(true);
    expect(scopeSatisfies(["admin"], "admin")).toBe(true);
  });

  it("write satisfies read and write but NOT admin", () => {
    expect(scopeSatisfies(["write"], "read")).toBe(true);
    expect(scopeSatisfies(["write"], "write")).toBe(true);
    expect(scopeSatisfies(["write"], "admin")).toBe(false);
  });

  it("read satisfies only read", () => {
    expect(scopeSatisfies(["read"], "read")).toBe(true);
    expect(scopeSatisfies(["read"], "write")).toBe(false);
    expect(scopeSatisfies(["read"], "admin")).toBe(false);
  });

  it("takes the highest-ranked scope in the array", () => {
    expect(scopeSatisfies(["read", "write", "admin"], "admin")).toBe(true);
    expect(scopeSatisfies(["read", "write"], "admin")).toBe(false);
    expect(scopeSatisfies(["read", "write"], "write")).toBe(true);
  });

  it("fails closed on an empty grant", () => {
    expect(scopeSatisfies([], "read")).toBe(false);
    expect(scopeSatisfies([], "write")).toBe(false);
    expect(scopeSatisfies([], "admin")).toBe(false);
  });

  it("ignores unrecognized granted scopes (they contribute no rank)", () => {
    expect(scopeSatisfies(["superuser"], "read")).toBe(false);
    // A recognized scope alongside an unknown one still governs.
    expect(scopeSatisfies(["superuser", "admin"], "write")).toBe(true);
  });
});
