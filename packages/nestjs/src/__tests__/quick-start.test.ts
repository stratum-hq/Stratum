import "reflect-metadata";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Controller, Get, Module, UseGuards } from "@nestjs/common";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { StratumClient } from "@stratum-hq/sdk";
import type { ResolvedTenantContext } from "@stratum-hq/core";
import { StratumGuard, StratumModule, Tenant } from "../index.js";

// This file boots the README quick start as written: the module imported once in
// AppModule, and the guard applied with @UseGuards on a controller in AppModule.
// The guard is then built in AppModule's injector, so every token that it injects
// must be exported from StratumModule.

const JWT_SECRET = "quick-start-secret-0123456789abcdef";
const TENANT_ID = "tenant-quick-start";

function base64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function signHs256(payload: Record<string, unknown>, secret: string): string {
  const unsigned = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

@Controller("data")
@UseGuards(StratumGuard)
class DataController {
  @Get()
  getData(@Tenant() tenant: ResolvedTenantContext) {
    return { tenantId: tenant.tenant_id, config: tenant.resolved_config };
  }
}

const QUICK_START_OPTIONS = {
  controlPlaneUrl: "http://localhost:3001",
  apiKey: "sk_live_your_key",
  jwtSecret: JWT_SECRET,
  jwtClaimPath: "tenant_id",
};

@Module({
  imports: [StratumModule.forRoot(QUICK_START_OPTIONS)],
  controllers: [DataController],
})
class AppModule {}

@Module({
  imports: [StratumModule.forRootAsync({ useFactory: () => QUICK_START_OPTIONS })],
  controllers: [DataController],
})
class AsyncAppModule {}

describe.each([
  { registration: "forRoot", appModule: AppModule },
  { registration: "forRootAsync", appModule: AsyncAppModule },
])("README quick start on a real Nest application with $registration", ({ appModule }) => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    // The control plane is not running, so the test answers the tenant lookup.
    vi.spyOn(StratumClient.prototype, "resolveTenant").mockImplementation(async (tenantId: string) => ({
      tenant_id: tenantId,
      ancestry_path: tenantId,
      depth: 0,
      resolved_config: { theme: { value: "dark" } },
      resolved_permissions: {},
      isolation_strategy: "SHARED_RLS",
    }) as unknown as ResolvedTenantContext);

    // abortOnError: false makes a startup failure throw, where Nest would otherwise
    // exit the process and stop the test runner.
    app = await NestFactory.create(appModule, { logger: false, abortOnError: false });
    await app.listen(0, "127.0.0.1");
    const { port } = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app?.close();
    vi.restoreAllMocks();
  });

  async function getData(token: string): Promise<{ status: number; body: unknown }> {
    const response = await fetch(`${baseUrl}/data`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() };
  }

  it("starts the application", () => {
    expect(baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("binds the tenant from a token signed with jwtSecret", async () => {
    const { status, body } = await getData(signHs256({ tenant_id: TENANT_ID }, JWT_SECRET));
    expect(status).toBe(200);
    expect(body).toEqual({ tenantId: TENANT_ID, config: { theme: { value: "dark" } } });
  });

  it("rejects a token signed with another secret with 401", async () => {
    const { status } = await getData(signHs256({ tenant_id: TENANT_ID }, "forged-secret-forged-secret-forged!!"));
    expect(status).toBe(401);
  });

  it("rejects an unsigned alg=none token with 401", async () => {
    const unsigned = `${base64url(JSON.stringify({ alg: "none", typ: "JWT" }))}.${base64url(JSON.stringify({ tenant_id: TENANT_ID }))}.`;
    const { status } = await getData(unsigned);
    expect(status).toBe(401);
  });
});
