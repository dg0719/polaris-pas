import { describe, expect, test } from 'vitest';
import { TransitionError, transition } from '../src/stateMachine.ts';
import type { JobGuardContext } from '../src/stateMachine.ts';

const csr: JobGuardContext = { requiresUw: false, uwApproved: false, actorRole: 'csr' };
const uw: JobGuardContext = { requiresUw: false, uwApproved: false, actorRole: 'underwriter' };

describe('job state machine', () => {
  test('happy path: Draft → Quoted → Bound → Issued', () => {
    let s = transition('Draft', 'quote', csr);
    expect(s).toBe('Quoted');
    s = transition(s, 'bind', csr);
    expect(s).toBe('Bound');
    s = transition(s, 'issue', csr);
    expect(s).toBe('Issued');
  });

  test('editing data returns a quoted job to Draft', () => {
    expect(transition('Quoted', 'editData', csr)).toBe('Draft');
  });

  test('cannot bind from Draft', () => {
    expect(() => transition('Draft', 'bind', csr)).toThrow(TransitionError);
  });

  test('cannot issue an unbound job', () => {
    expect(() => transition('Quoted', 'issue', csr)).toThrow(TransitionError);
  });

  test('bind blocked when UW referral pending', () => {
    const ctx: JobGuardContext = { requiresUw: true, uwApproved: false, actorRole: 'csr' };
    expect(() => transition('Quoted', 'bind', ctx)).toThrow(/underwriter approval/);
  });

  test('bind allowed after UW approval', () => {
    const ctx: JobGuardContext = { requiresUw: true, uwApproved: true, actorRole: 'csr' };
    expect(transition('Quoted', 'bind', ctx)).toBe('Bound');
  });

  test('CSR cannot approve a UW referral; underwriter can', () => {
    expect(() => transition('Quoted', 'uwApprove', csr)).toThrow(/Only an underwriter/);
    expect(transition('Quoted', 'uwApprove', uw)).toBe('Quoted');
  });

  test('underwriter can decline', () => {
    expect(transition('Quoted', 'uwDecline', uw)).toBe('Declined');
  });

  test('cannot act on terminal states', () => {
    expect(() => transition('Issued', 'quote', csr)).toThrow(TransitionError);
    expect(() => transition('Declined', 'bind', csr)).toThrow(TransitionError);
    expect(() => transition('Withdrawn', 'quote', csr)).toThrow(TransitionError);
  });

  test('withdraw allowed from Draft, Quoted, Bound', () => {
    expect(transition('Draft', 'withdraw', csr)).toBe('Withdrawn');
    expect(transition('Quoted', 'withdraw', csr)).toBe('Withdrawn');
    expect(transition('Bound', 'withdraw', csr)).toBe('Withdrawn');
  });
});
