ALTER TABLE users ADD COLUMN driver_status TEXT;
ALTER TABLE users ADD COLUMN profile_photo TEXT;
ALTER TABLE users ADD COLUMN vehicle_photo TEXT;
ALTER TABLE users ADD COLUMN passenger_tutorial_seen INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN driver_tutorial_seen INTEGER NOT NULL DEFAULT 0;

UPDATE users
SET driver_status = CASE
  WHEN role = 'driver' AND status IN ('pending', 'approved') THEN 'approved'
  WHEN role = 'driver' AND status IN ('rejected', 'suspended') THEN status
  WHEN role = 'driver' THEN 'approved'
  ELSE NULL
END;

-- A situação da conta e a situação como motorista passam a ser independentes.
-- Assim, até um motorista suspenso ainda pode usar a Aura Bae como passageiro.
UPDATE users SET status = 'active' WHERE role = 'driver';

CREATE INDEX IF NOT EXISTS idx_users_driver_status ON users(driver_status);

ALTER TABLE rides ADD COLUMN last_activity_at TEXT;
ALTER TABLE rides ADD COLUMN cancellation_reason TEXT;
ALTER TABLE rides ADD COLUMN auto_cancelled INTEGER NOT NULL DEFAULT 0;

UPDATE rides
SET last_activity_at = COALESCE(completed_at, paid_at, arrived_at, accepted_at, created_at, CURRENT_TIMESTAMP);

CREATE INDEX IF NOT EXISTS idx_rides_activity ON rides(status, last_activity_at);

CREATE TABLE IF NOT EXISTS password_reset_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'completed', 'rejected', 'expired')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_password_resets_status ON password_reset_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_reset_requests(user_id, created_at DESC);
