import type { Db } from '../db.ts';
import { jobDto, policyDto, policyVersionDto, transactionDto } from '../dto.ts';
import { ApiError } from '../errors.ts';
import type { Router } from '../http.ts';
import { issueJob } from '../issue.ts';
import { bindJob, quoteJob, underwriteJob, updateRisk, withdrawJob } from '../jobs.ts';
import * as repo from '../repo.ts';
import { parseRiskData, requireString } from '../validation.ts';
import { authenticated, body, jobResponse, param } from './context.ts';

export function registerJobRoutes(router: Router, db: Db): void {
  const authed = authenticated(db);

  router.get(
    '/jobs',
    authed((ctx, tenant) => ({
      jobs: repo
        .listJobs(db, tenant, {
          status: ctx.query.get('status') ?? undefined,
          accountId: ctx.query.get('accountId') ?? undefined,
        })
        .map(jobDto),
    })),
  );

  router.get(
    '/jobs/:id',
    authed((ctx, tenant) => jobResponse(db, tenant, param(ctx, 'id'))),
  );

  router.put(
    '/jobs/:id/risk',
    authed((ctx, tenant) => {
      const jobId = param(ctx, 'id');
      updateRisk(db, tenant, jobId, parseRiskData(body(ctx)['risk']));
      return jobResponse(db, tenant, jobId);
    }),
  );

  router.post(
    '/jobs/:id/quote',
    authed((ctx, tenant) => {
      const jobId = param(ctx, 'id');
      const { quote } = quoteJob(db, tenant, jobId);
      return { ...jobResponse(db, tenant, jobId), quote };
    }),
  );

  router.post(
    '/jobs/:id/underwrite',
    authed((ctx, tenant) => {
      const jobId = param(ctx, 'id');
      const input = body(ctx);
      const decision = input['decision'];
      if (decision !== 'approve' && decision !== 'decline') {
        throw ApiError.badRequest("decision must be 'approve' or 'decline'");
      }
      const note = input['note'] === undefined ? undefined : requireString(input['note'], 'note');
      underwriteJob(db, tenant, jobId, decision, note);
      return jobResponse(db, tenant, jobId);
    }, ['underwriter', 'admin']),
  );

  router.post(
    '/jobs/:id/bind',
    authed((ctx, tenant) => {
      const jobId = param(ctx, 'id');
      bindJob(db, tenant, jobId);
      return jobResponse(db, tenant, jobId);
    }),
  );

  router.post(
    '/jobs/:id/issue',
    authed((ctx, tenant) => {
      const result = issueJob(db, tenant, param(ctx, 'id'));
      return {
        job: jobDto(result.job),
        policy: policyDto(result.policy),
        version: policyVersionDto(result.version),
        transaction: transactionDto(result.transaction),
      };
    }),
  );

  router.post(
    '/jobs/:id/withdraw',
    authed((ctx, tenant) => {
      const jobId = param(ctx, 'id');
      const note = body(ctx)['note'];
      withdrawJob(db, tenant, jobId, note === undefined ? undefined : requireString(note, 'note'));
      return jobResponse(db, tenant, jobId);
    }),
  );
}
