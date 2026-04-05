import { Injectable } from "@nestjs/common";
import type { NestInterceptor, ExecutionContext, CallHandler } from "@nestjs/common";
import { Observable } from "rxjs";
import { runWithTenantContext } from "@stratum-hq/sdk";

@Injectable()
export class StratumContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    const tenantCtx = req.tenant;
    if (!tenantCtx) return next.handle();
    return new Observable((subscriber) => {
      runWithTenantContext(tenantCtx, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
