import { Module, DynamicModule, Global } from "@nestjs/common";
import type { FactoryProvider, ModuleMetadata } from "@nestjs/common";
import { StratumClient } from "@stratum-hq/sdk";
import { STRATUM_CLIENT, STRATUM_OPTIONS } from "./constants.js";
import { StratumGuard } from "./stratum.guard.js";

export interface StratumModuleOptions {
  controlPlaneUrl: string;
  apiKey: string;
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
      providers: [clientProvider, optionsProvider, StratumGuard],
      exports: [STRATUM_CLIENT, StratumGuard],
    };
  }

  /**
   * Register StratumModule asynchronously using a factory function.
   * Useful when options come from ConfigService or other async providers.
   */
  static forRootAsync(asyncOptions: StratumModuleAsyncOptions): DynamicModule {
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
      providers: [clientProvider, StratumGuard],
      exports: [STRATUM_CLIENT, StratumGuard],
    };
  }
}
