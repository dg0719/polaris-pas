import type { Db } from '../db.ts';
import type { Migration } from './index.ts';

/**
 * Two new roles — `billing` and `finance` — join the CHECK on `users.role`.
 *
 * SQLite cannot alter a CHECK constraint in place, so the table is rebuilt:
 * copy the rows across, drop the old table, rename the new one, recreate the
 * one explicit index (the UNIQUE column constraints on `username` and
 * `api_key` come back with the column definitions).
 *
 * Nine tables carry a foreign key to `users(id)` — `jobs.created_by` among
 * them — so dropping the table is only possible with foreign keys switched
 * off. `migrate()` does that for the length of the run and checks afterwards
 * that nothing was left dangling; see the note there for why the pragmas
 * that work inside a transaction do not.
 */
const SQL = `
CREATE TABLE users_new (
  id             TEXT PRIMARY KEY,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id),
  username       TEXT NOT NULL UNIQUE,
  email          TEXT NOT NULL,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('csr','underwriter','adjuster','claims_supervisor','admin','billing','finance')),
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  api_key        TEXT NOT NULL UNIQUE,
  authority_limit_cents INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);

INSERT INTO users_new
  (id, tenant_id, username, email, name, role, password_hash, password_salt,
   api_key, authority_limit_cents, created_at)
SELECT id, tenant_id, username, email, name, role, password_hash, password_salt,
       api_key, authority_limit_cents, created_at
  FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;

CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email ON users(tenant_id, email);
`;

export const billingRoles: Migration = {
  id: 3,
  name: 'billing_roles',
  up(db: Db) {
    db.exec(SQL);
  },
};
