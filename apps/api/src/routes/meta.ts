import type { Db } from '../db.ts';
import type { Router } from '../http.ts';
import { getProduct, listProducts } from '../products.ts';
import { referralQueue, readyToBind, worklistCounts } from '../worklist.ts';
import { listDemoCredentials } from '../demo.ts';
import { signIn } from '../auth.ts';
import { authenticated, body, param } from './context.ts';

export function registerMetaRoutes(router: Router, db: Db): void {
  const authed = authenticated(db);

  router.get('/health', () => ({ status: 'ok' }));

  router.post('/auth/login', (ctx) => {
    const input = body(ctx);
    return signIn(db, input['username'], input['password']);
  });

  router.get('/products', () => ({
    products: listProducts().map((p) => ({
      productCode: p.productCode,
      productName: p.productName,
      province: p.province,
      version: p.version,
      effectiveDate: p.effectiveDate,
      sample: p.sample,
    })),
  }));

  // The full definition, including coverages and options, drives the wizard.
  router.get('/products/:code', (ctx) => ({ product: getProduct(param(ctx, 'code')) }));

  router.get(
    '/me',
    authed((_ctx, tenant) => ({
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      role: tenant.role,
    })),
  );

  router.get(
    '/worklist',
    authed((_ctx, tenant) => ({
      counts: worklistCounts(db, tenant),
      referrals: referralQueue(db, tenant),
      readyToBind: readyToBind(db, tenant),
    })),
  );
}

/**
 * The credential hint printed under the sign-in form. Off unless
 * POLARIS_DEMO=1, so a real deployment never advertises a login.
 */
export function registerDemoRoutes(router: Router, db: Db): void {
  if (process.env.POLARIS_DEMO !== '1') return;

  router.get('/demo/credentials', () => ({ credentials: listDemoCredentials() }));
}
