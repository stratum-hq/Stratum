import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Mock } from "vitest";
import { FastifyInstance } from "fastify";
import { config } from "../config.js";
import { createMockStratum, buildTestApp, jwtHeaders, SAMPLE_TENANT } from "./test-helpers.js";
import type { Stratum } from "@stratum-hq/lib";

describe("JWT audience and issuer binding", () => {
  let app: FastifyInstance;
  let stratum: Stratum;
  const saved = { audience: config.jwtAudience, issuer: config.jwtIssuer };

  beforeEach(async () => {
    stratum = createMockStratum();
    (stratum.getTenant as Mock).mockResolvedValue(SAMPLE_TENANT);
    app = await buildTestApp(stratum);
  });

  afterEach(async () => {
    config.jwtAudience = saved.audience;
    config.jwtIssuer = saved.issuer;
    await app.close();
  });

  function get(headers: Record<string, string>) {
    return app.inject({ method: "GET", url: `/api/v1/tenants/${SAMPLE_TENANT.id}`, headers });
  }

  describe("when an audience is configured", () => {
    beforeEach(() => {
      config.jwtAudience = "stratum-control-plane";
    });

    it("rejects a token that carries no audience", async () => {
      const res = await get(jwtHeaders());
      expect(res.statusCode).toBe(401);
    });

    it("rejects a token issued for a different audience", async () => {
      const res = await get(jwtHeaders({ aud: "my-app" }));
      expect(res.statusCode).toBe(401);
    });

    it("accepts a token issued for the control plane audience", async () => {
      const res = await get(jwtHeaders({ aud: "stratum-control-plane" }));
      expect(res.statusCode).toBe(200);
    });
  });

  describe("when an issuer is configured", () => {
    beforeEach(() => {
      config.jwtIssuer = "https://issuer.example";
    });

    it("rejects a token from a different issuer", async () => {
      const res = await get(jwtHeaders({ iss: "https://other.example" }));
      expect(res.statusCode).toBe(401);
    });

    it("accepts a token from the configured issuer", async () => {
      const res = await get(jwtHeaders({ iss: "https://issuer.example" }));
      expect(res.statusCode).toBe(200);
    });
  });

  it("accepts a token without an audience when none is configured", async () => {
    config.jwtAudience = undefined;
    config.jwtIssuer = undefined;
    const res = await get(jwtHeaders());
    expect(res.statusCode).toBe(200);
  });
});
