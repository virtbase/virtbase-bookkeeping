export const MIGRATIONS: string[] = [
  `
  CREATE TABLE transactions (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    kind TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    value_at INTEGER NOT NULL,
    name TEXT,
    purpose TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    stripe_fee_cents INTEGER NOT NULL DEFAULT 0,
    passthrough_fee_cents INTEGER NOT NULL DEFAULT 0,
    method TEXT,
    reference TEXT,
    needs_review INTEGER NOT NULL DEFAULT 0,
    review_reason TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    xmr_atomic TEXT,
    xmr_rate REAL,
    rate_source TEXT,
    rate_window TEXT,
    market_value_cents INTEGER,
    product TEXT,
    wallet_label TEXT,
    invoice_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX transactions_occurred_at ON transactions (occurred_at);
  CREATE TABLE export_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    first_at INTEGER NOT NULL,
    last_at INTEGER NOT NULL,
    row_count INTEGER NOT NULL,
    net_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    sha256 TEXT NOT NULL
  );
  CREATE TABLE export_rows (
    batch_id INTEGER NOT NULL REFERENCES export_batches (id),
    transaction_id TEXT NOT NULL REFERENCES transactions (id),
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE UNIQUE INDEX export_rows_one_active ON export_rows (transaction_id) WHERE active = 1;
  CREATE INDEX export_rows_batch ON export_rows (batch_id);
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    type TEXT NOT NULL,
    detail TEXT NOT NULL
  );
  CREATE TABLE lexware_invoices (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL,
    day TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    customer TEXT NOT NULL,
    product TEXT,
    fetched_at INTEGER NOT NULL
  );
  `,
  `
  ALTER TABLE transactions ADD COLUMN description TEXT;
  ALTER TABLE transactions ADD COLUMN refund_reason TEXT;
  ALTER TABLE transactions ADD COLUMN company TEXT;
  UPDATE transactions SET company = 'stripe' WHERE name = 'Stripe Technology Europe, Limited';
  UPDATE transactions SET company = 'paypal' WHERE name = 'PayPal (Europe) S.à r.l. et Cie, S.C.A.';
  UPDATE transactions SET description = purpose
    WHERE source = 'stripe'
    AND kind NOT IN ('payout', 'refund', 'payment_refund', 'payment_failure_refund');
  DELETE FROM settings WHERE key = 'stripe.syncedFrom';
  `,
  `
  PRAGMA defer_foreign_keys = ON;
  ALTER TABLE transactions ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;
  CREATE TEMP TABLE monero_ids AS
    SELECT id AS old_id,
      'xmr:' || reference || ':' || xmr_atomic ||
        CASE WHEN position > 1 THEN ':' || (position - 1) ELSE '' END AS new_id
    FROM (
      SELECT id, reference, xmr_atomic,
        ROW_NUMBER() OVER (PARTITION BY reference, xmr_atomic ORDER BY id) AS position
      FROM transactions WHERE source = 'monero'
    );
  UPDATE export_rows SET transaction_id =
    (SELECT new_id FROM monero_ids WHERE old_id = transaction_id)
    WHERE transaction_id IN (SELECT old_id FROM monero_ids);
  UPDATE transactions SET id =
    (SELECT new_id FROM monero_ids WHERE old_id = id)
    WHERE id IN (SELECT old_id FROM monero_ids);
  DROP TABLE monero_ids;
  `,
  `
  ALTER TABLE export_batches ADD COLUMN account TEXT NOT NULL DEFAULT '';
  `,
  `
  INSERT INTO settings (key, value)
    SELECT 'setup.completedAt', CAST(strftime('%s', 'now') AS TEXT)
    WHERE EXISTS (SELECT 1 FROM transactions)
      OR EXISTS (SELECT 1 FROM settings);
  `,
];
