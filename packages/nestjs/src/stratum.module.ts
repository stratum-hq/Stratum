import { Module, DynamicModule, Global } from "@nestjs/common";
import type { FactoryProvider, ModuleMetadata } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { StratumClient } from "@stratum-hq/sdk";
import { STRATUM_CLIENT, STRATUM_OPTIONS } from "./constants.js";
import { StratumGuard } from "./stratum.guard.js";
import { StratumContextInterceptor } from "./stratum.interceptor.js";

export interface StratumModuleOptions {
  controlPlaneUrl: string;
  apiKey: string;
  /** JWT claim path for tenant resolution (e.g. "tenant_id" or "stratum.tenant_id"). Requires jwtSecret or jwtVerify. */
  jwtClaimPath?: string;
  /** HMAC secret used to verify JWT signatures before extracting tenant claims. */
  jwtSecret?: string;
  /** Custom JWT verify function — takes priority over jwtSecret. */
  jwtVerify?: (token: string) => Record<string, unknown> | null;
  /** Custom tenant resolvers evaluated after header and JWT resolution. */
  resolvers?: import("@stratum-hq/sdk").TenantResolver[];
  /** Enable tenant impersonation via X-Impersonate-Tenant header. */
  impersonation?: {
    enabled: boolean;
    headerName?: string;
    authorize: (req: unknown, callerTenantId: string, targetTenantId: string) => boolean | Promise<boolean>;
    onImpersonate?: (req: unknown, callerTenantId: string, targetTenantId: string) => void;
  };
}

export interface StratumModuleAsyncOptions extends Pick<ModuleMetadata, "imports"> {
  useFactory: (...args: unknown[]) => StratumModuleOptions | Promise<StratumModuleOptions>;
  inject?: FactoryProvider["inject"];
}

@Global()
@Module({})
export class StratumModule {
  /**
   * Register StratumModule synchronously with static options.
   */
  static forRoot(options: StratumModuleOptions): DynamicModule {
    const clientProvider = {
      provide: STRATUM_CLIENT,
      useValue: new StratumClient({
        controlPlaneUrl: options.controlPlaneUrl,
        apiKey: options.apiKey,
      }),
    };

    const optionsProvider = {
      provide: STRATUM_OPTIONS,
      useValue: options,
    };

    return {
      module: StratumModule,
      providers: [clientProvider, optionsProvider, StratumGuard, { provide: APP_INTERCEPTOR, useClass: StratumContextInterceptor }],
      exports: [STRATUM_CLIENT, StratumGuard],
    };
  }

  /**
   * Register StratumModule asynchronously using a factory function.
   * Useful when options come from ConfigService or other async providers.
   */
  static forRootAsync(asyncOptions: StratumModuleAsyncOptions): DynamicModule {
    const optionsProvider: FactoryProvider = {
      provide: STRATUM_OPTIONS,
      useFactory: asyncOptions.useFactory,
      inject: asyncOptions.inject ?? [],
    };

    const clientProvider: FactoryProvider = {
      provide: STRATUM_CLIENT,
      useFactory: async (...args: unknown[]) => {
        const options = await asyncOptions.useFactory(...args);
        return new StratumClient({
          controlPlaneUrl: options.controlPlaneUrl,
          apiKey: options.apiKey,
        });
      },
      inject: asyncOptions.inject ?? [],
    };

    return {
      module: StratumModule,
      imports: asyncOptions.imports ?? [],
      providers: [optionsProvider, clientProvider, StratumGuard, { provide: APP_INTERCEPTOR, useClass: StratumContextInterceptor }],
      exports: [STRATUM_CLIENT, StratumGuard],
    };
  }
}
