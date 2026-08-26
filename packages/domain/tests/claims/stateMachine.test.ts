import { describe, expect, test } from 'vitest';
import {
  ClaimTransitionError,
  exposureTransition,
  claimTransition,
  paymentTransition,
  recoveryTransition,
} from '../../src/claims/stateMachine.ts';

describe('claim lifecycle', () => {
  test('open ⇄ closed', () => {
    expect(claimTransition('Open', 'close', { openExposures: 0, undecidedPayments: 0 })).toBe(
      'Closed',
    );
    expect(claimTransition('Closed', 'reopen', { openExposures: 0, undecidedPayments: 0 })).toBe(
      'Open',
    );
  });

  test('cannot close with an open exposure', () => {
    expect(() =>
      claimTransition('Open', 'close', { openExposures: 2, undecidedPayments: 0 }),
    ).toThrow(/open exposure/);
  });

  test('cannot close with a payment awaiting a decision', () => {
    expect(() =>
      claimTransition('Open', 'close', { openExposures: 0, undecidedPayments: 1 }),
    ).toThrow(/payment/);
  });

  test('cannot close a closed claim', () => {
    expect(() =>
      claimTransition('Closed', 'close', { openExposures: 0, undecidedPayments: 0 }),
    ).toThrow(ClaimTransitionError);
  });
});

describe('exposure lifecycle', () => {
  test('open ⇄ closed', () => {
    expect(exposureTransition('Open', 'close')).toBe('Closed');
    expect(exposureTransition('Closed', 'reopen')).toBe('Open');
  });

  test('cannot reopen an open exposure', () => {
    expect(() => exposureTransition('Open', 'reopen')).toThrow(ClaimTransitionError);
  });
});

describe('payment lifecycle', () => {
  test('requested → approved → issued', () => {
    expect(paymentTransition('Requested', 'approve')).toBe('Approved');
    expect(paymentTransition('Approved', 'issue')).toBe('Issued');
  });

  test('requested or approved can be rejected', () => {
    expect(paymentTransition('Requested', 'reject')).toBe('Rejected');
    expect(paymentTransition('Approved', 'reject')).toBe('Rejected');
  });

  test('only an issued payment can be voided', () => {
    expect(paymentTransition('Issued', 'void')).toBe('Voided');
    expect(() => paymentTransition('Requested', 'void')).toThrow(ClaimTransitionError);
  });

  test('an issued payment cannot be approved again', () => {
    expect(() => paymentTransition('Issued', 'approve')).toThrow(ClaimTransitionError);
  });

  test('cannot issue straight from requested', () => {
    expect(() => paymentTransition('Requested', 'issue')).toThrow(ClaimTransitionError);
  });
});

describe('recovery lifecycle', () => {
  test('open → recovered → closed', () => {
    expect(recoveryTransition('Open', 'markRecovered')).toBe('Recovered');
    expect(recoveryTransition('Recovered', 'close')).toBe('Closed');
  });

  test('open can close without recovering (written off)', () => {
    expect(recoveryTransition('Open', 'close')).toBe('Closed');
  });

  test('closed is terminal', () => {
    expect(() => recoveryTransition('Closed', 'markRecovered')).toThrow(ClaimTransitionError);
  });
});
