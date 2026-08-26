import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import { balanceMoney, deltaMoney, money } from '../lib/format.ts';

// ─── Buttons ────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export function Button({
  variant = 'secondary',
  loading = false,
  children,
  className = '',
  ...rest
}: { variant?: ButtonVariant; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} ${className}`.trim()}
      data-loading={loading}
      aria-busy={loading || undefined}
      disabled={rest.disabled || loading}
      {...rest}
    >
      {children}
    </button>
  );
}

// ─── Money ──────────────────────────────────────────────────────────────────

/**
 * `delta` shows direction (+/−) for a change in premium; `balance` marks a
 * credit; plain shows the amount. Negative always reads in the negative colour
 * as well as with a sign, never colour alone.
 */
export function Money({
  cents,
  delta = false,
  balance = false,
}: {
  cents: number;
  delta?: boolean;
  balance?: boolean;
}) {
  const text = delta ? deltaMoney(cents) : balance ? balanceMoney(cents) : money(cents);
  return <span className={`mono${cents < 0 ? ' money--negative' : ''}`}>{text}</span>;
}

// ─── Status ─────────────────────────────────────────────────────────────────

const FLAGGED = new Set(['Referred', 'referred', 'due', 'Requested']);
const NEGATIVE = new Set(['Declined', 'Cancelled', 'Withdrawn', 'overdue', 'Expired', 'Rejected']);
const DONE = new Set(['Issued', 'InForce', 'paid', 'Bound', 'credit', 'Approved', 'Recovered', 'done']);

/** Status always reads as a word; colour is redundant reinforcement. */
export function Status({ value, label }: { value: string; label?: string }) {
  const modifier = FLAGGED.has(value)
    ? ' status--flag'
    : NEGATIVE.has(value)
      ? ' status--negative'
      : DONE.has(value)
        ? ' status--done'
        : value === 'void' || value === 'Voided'
          ? ' status--muted'
          : '';
  return <span className={`status${modifier}`}>{label ?? humanise(value)}</span>;
}

function humanise(value: string): string {
  if (value === 'InForce') return 'In force';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// ─── Layout helpers ─────────────────────────────────────────────────────────

export function PageHead({
  eyebrow,
  title,
  meta,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div className="page-head__titles">
        {eyebrow ? <div className="page-head__eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {meta ? <div className="page-head__meta">{meta}</div> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </header>
  );
}

export function Section({
  title,
  note,
  actions,
  children,
}: {
  title?: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="section">
      {title || actions ? (
        <div className="section__head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {note ? <p className="section__note">{note}</p> : null}
          </div>
          {actions ? <div className="btn-row">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Facts({ children, tight = false }: { children: ReactNode; tight?: boolean }) {
  return <dl className={`facts${tight ? ' facts--tight' : ''}`}>{children}</dl>;
}

export function Fact({
  label,
  children,
  lead = false,
}: {
  label: ReactNode;
  children: ReactNode;
  lead?: boolean;
}) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd className={lead ? 'fact-value--lead' : undefined}>{children}</dd>
    </div>
  );
}

// ─── Forms ──────────────────────────────────────────────────────────────────

let fieldSeq = 0;

export function Field({
  label,
  hint,
  error,
  children,
  id,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: (props: { id: string; 'aria-describedby'?: string }) => ReactNode;
  id?: string;
}) {
  const fieldId = id ?? `f${++fieldSeq}`;
  const describedBy = error ? `${fieldId}-err` : hint ? `${fieldId}-hint` : undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      {children({ id: fieldId, 'aria-describedby': describedBy })}
      {error ? (
        <span className="field__error" id={`${fieldId}-err`}>
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint" id={`${fieldId}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input${props.type === 'number' ? ' input--num' : ''}`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props} />;
}

export function Choice({
  name,
  value,
  checked,
  onChange,
  title,
  note,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  title: ReactNode;
  note?: ReactNode;
}) {
  return (
    <label className="choice">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
      />
      <span>
        <span className="choice__title">{title}</span>
        {note ? (
          <>
            <br />
            <span className="choice__note">{note}</span>
          </>
        ) : null}
      </span>
    </label>
  );
}

// ─── States ─────────────────────────────────────────────────────────────────

export function Notice({
  tone = 'plain',
  children,
}: {
  tone?: 'plain' | 'error' | 'flag';
  children: ReactNode;
}) {
  const modifier = tone === 'plain' ? '' : ` notice--${tone}`;
  return (
    <p className={`notice${modifier}`} role={tone === 'error' ? 'alert' : undefined}>
      {children}
    </p>
  );
}

export function Empty({
  title,
  body,
  action,
}: {
  title: ReactNode;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <p className="empty__title">{title}</p>
      <p className="empty__body">{body}</p>
      {action}
    </div>
  );
}

/** Skeleton rows match the height of the rows they stand in for. */
export function TableSkeleton({ columns, rows = 4 }: { columns: number; rows?: number }) {
  return (
    <tbody aria-hidden="true">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {Array.from({ length: columns }, (_, c) => (
            <td key={c}>
              <span className="skeleton" style={{ display: 'block', width: c === 0 ? '60%' : '40%' }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <div className="toast" role="status">
      {message}
    </div>
  );
}
