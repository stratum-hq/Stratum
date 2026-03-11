import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "../crypto.js";

describe("crypto", () => {
  it("encrypts and decrypts round-trip", () => {
    const plaintext = "my-secret-value-for-testing";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces versioned format v1:iv:tag:ct", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("decrypts legacy format (no version prefix)", () => {
    // Encrypt, then strip the v1: prefix to simulate legacy
    const encrypted = encrypt("legacy-test");
    const legacy = encrypted.replace(/^v1:/, "");
    expect(decrypt(legacy)).toBe("legacy-test");
  });

  it("throws on invalid format", () => {
    expect(() => decrypt("invalid")).toThrow("Invalid encrypted value format");
  });

  it("different plaintexts produce different ciphertexts", () => {
    const a = encrypt("value-a");
    const b = encrypt("value-b");
    expect(a).not.toBe(b);
  });

  it("same plaintext produces different ciphertexts (random IV)", () => {
    const a = encrypt("same-value");
    const b = encrypt("same-value");
    expect(a).not.toBe(b);
    // But both decrypt to same value
    expect(decrypt(a)).toBe("same-value");
    expect(decrypt(b)).toBe("same-value");
  });
});
