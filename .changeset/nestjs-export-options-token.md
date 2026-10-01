---
"@stratum-hq/nestjs": patch
---

`StratumModule` now exports the `STRATUM_OPTIONS` token. Before this change, an application that used `@UseGuards(StratumGuard)` on a controller, as the quick start shows, failed at startup with `UnknownDependenciesException`, because Nest could not give the guard its options in the controller's module. This applies to `forRoot` and `forRootAsync`.
