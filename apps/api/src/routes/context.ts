import type { Role } from '@polaris/domain';
import { authenticate, requireRole } from '../auth.ts';
import type { Db } from '../db.ts';
import { jobDto, jobEventDto } from '../dto.ts';
import { ApiError } from '../errors.ts';
import type { Handler, RequestContext } from '../http.ts';
import { requireJob } from '../jobs.ts';
import * as repo from '../repo.ts';
import type { TenantCtx } from '../repo.ts';

export type AuthedHandler = (ctx: RequestContext, tenant: TenantCtx) => unknown;

/** Wrap a handler so it only runs for an authenticated caller in an allowed role. */
export function authenticated(db: Db) {
  return (handler: AuthedHandler, roles: Role[] = []): Handler =>
    (ctx: RequestContext) => {
      const { ctx: tenant } = authenticate(db, ctx.req);
      if (roles.length > 0) requireRole(tenant, ...roles);
      return handler(ctx, tenant);
    };
}

export function body(ctx: RequestContext): Record<string, unknown> {
  if (ctx.body === undefined) return {};
  if (typeof ctx.body !== 'object' || ctx.body === null || Array.isArray(ctx.body)) {
    throw ApiError.badRequest('Request body must be a JSON object');
  }
  return ctx.body as Record<string, unknown>;
}

export function param(ctx: RequestContext, name: string): string {
  const value = ctx.params[name];
  if (!value) throw ApiError.badRequest(`Missing path parameter ${name}`);
  return value;
}

/** The standard job payload: the job itself plus its audit trail. */
export function jobResponse(db: Db, tenant: TenantCtx, jobId: string) {
  const job = requireJob(db, tenant, jobId);
  return {
    job: jobDto(job),
    events: repo.listJobEvents(db, tenant, jobId).map(jobEventDto),
  };
}
