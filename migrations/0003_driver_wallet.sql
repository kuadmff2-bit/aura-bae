PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS wallet_topups (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 500),
  asaas_payment_id TEXT NOT NULL UNIQUE,
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  payload TEXT NOT NULL,
  encoded_image TEXT NOT NULL,
  expiration_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_wallet_topups_driver ON wallet_topups(driver_id, created_at DESC);

CREATE TABLE IF NOT EXISTS driver_wallet_entries (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ride_id TEXT REFERENCES rides(id),
  topup_id TEXT REFERENCES wallet_topups(id),
  kind TEXT NOT NULL CHECK (kind IN ('topup', 'cash_fee', 'adjustment')),
  amount_cents INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_driver_wallet_entries_driver ON driver_wallet_entries(driver_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_wallet_cash_ride ON driver_wallet_entries(ride_id, kind) WHERE ride_id IS NOT NULL AND kind = 'cash_fee';
CREATE UNIQUE INDEX IF NOT EXISTS idx_driver_wallet_topup_entry ON driver_wallet_entries(topup_id, kind) WHERE topup_id IS NOT NULL AND kind = 'topup';
