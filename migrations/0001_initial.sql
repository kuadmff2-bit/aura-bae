PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  cpf TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('passenger', 'driver', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'approved', 'rejected', 'suspended')),
  vehicle_type TEXT CHECK (vehicle_type IN ('mototaxi', 'motocarro', 'taxi')),
  vehicle_model TEXT,
  pix_key TEXT,
  pix_key_type TEXT CHECK (pix_key_type IN ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP')),
  asaas_customer_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS driver_locations (
  driver_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  is_online INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rides (
  id TEXT PRIMARY KEY,
  passenger_id TEXT NOT NULL REFERENCES users(id),
  driver_id TEXT REFERENCES users(id),
  vehicle_type TEXT NOT NULL CHECK (vehicle_type IN ('mototaxi', 'motocarro', 'taxi')),
  origin_lat REAL NOT NULL,
  origin_lng REAL NOT NULL,
  destination_lat REAL NOT NULL,
  destination_lng REAL NOT NULL,
  distance_km REAL NOT NULL,
  duration_minutes INTEGER NOT NULL,
  fare_cents INTEGER NOT NULL,
  fixed_fee_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  driver_share_cents INTEGER NOT NULL,
  platform_share_cents INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'PIX' CHECK (payment_method IN ('PIX', 'CASH')),
  status TEXT NOT NULL CHECK (status IN ('searching', 'accepted', 'in_progress', 'arrived', 'payment_pending', 'paid', 'completed', 'cancelled')),
  cancel_fee_cents INTEGER NOT NULL DEFAULT 0,
  asaas_payment_id TEXT,
  payment_status TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  accepted_at TEXT,
  arrived_at TEXT,
  paid_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rides_passenger ON rides(passenger_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rides_driver ON rides(driver_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rides_payment ON rides(asaas_payment_id) WHERE asaas_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_qr_codes (
  ride_id TEXT PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  encoded_image TEXT NOT NULL,
  expiration_date TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  ride_id TEXT REFERENCES rides(id),
  kind TEXT NOT NULL CHECK (kind IN ('driver_credit', 'platform_credit', 'payout', 'adjustment', 'cash_debt')),
  amount_cents INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger_entries(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payouts (
  id TEXT PRIMARY KEY,
  driver_id TEXT NOT NULL REFERENCES users(id),
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  asaas_transfer_id TEXT,
  failure_reason TEXT,
  payout_day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payout_driver_day ON payouts(driver_id, payout_day);

CREATE TABLE IF NOT EXISTS ratings (
  id TEXT PRIMARY KEY,
  ride_id TEXT NOT NULL UNIQUE REFERENCES rides(id) ON DELETE CASCADE,
  passenger_id TEXT NOT NULL REFERENCES users(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
