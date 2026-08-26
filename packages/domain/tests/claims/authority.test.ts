import { describe, expect, test } from 'vitest';
import { approvalGuard, requiresApproval } from '../../src/claims/authority.ts';

describe('requiresApproval', () => {
  test('within and at the limit needs no second person', () => {
    expect(requiresApproval(999_999, 1_000_000)).toBe(false);
    expect(requiresApproval(1_000_000, 1_000_000)).toBe(false);
  });

  test('above the limit needs approval', () => {
    expect(requiresApproval(1_000_001, 1_000_000)).toBe(true);
  });

  test('a zero limit means everything needs approval', () => {
    expect(requiresApproval(1, 0)).toBe(true);
  });
});

describe('approvalGuard', () => {
  const base = {
    amountCents: 1_500_000,
    requestedByUserId: 'adjuster-1',
    actorUserId: 'supervisor-1',
    actorRole: 'claims_supervisor' as const,
    actorLimitCents: 10_000_000,
  };

  test('a supervisor within their limit may approve', () => {
    expect(approvalGuard(base)).toBeNull();
  });

  test('nobody approves their own payment', () => {
    expect(approvalGuard({ ...base, actorUserId: 'adjuster-1' })).toMatch(/own payment/);
  });

  test('the approver must also be within their own authority', () => {
    expect(approvalGuard({ ...base, actorLimitCents: 1_000_000 })).toMatch(/authority/);
  });

  test('an adjuster may approve within their limit', () => {
    expect(approvalGuard({ ...base, actorRole: 'adjuster' })).toBeNull();
  });

  test('a CSR may not approve claim payments at all', () => {
    expect(approvalGuard({ ...base, actorRole: 'csr' })).toMatch(/cannot approve/);
  });

  test('an underwriter may not approve claim payments', () => {
    expect(approvalGuard({ ...base, actorRole: 'underwriter' })).toMatch(/cannot approve/);
  });

  test('admin may approve within their limit', () => {
    expect(approvalGuard({ ...base, actorRole: 'admin' })).toBeNull();
  });
});
