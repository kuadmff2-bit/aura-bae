PRAGMA foreign_keys = ON;

-- Contadores curtos: armazenam apenas uma impressão SHA-256, nunca IP, CPF ou telefone puro.
CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key_hash TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  window_started_at TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_expiry ON rate_limit_counters(expires_at);

-- Registro mínimo para investigar ações administrativas e alterações de segurança.
CREATE TABLE IF NOT EXISTS security_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  target_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_security_audit_created ON security_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_audit_actor ON security_audit_log(actor_id, created_at DESC);

ALTER TABLE users ADD COLUMN deleted_at TEXT;
ALTER TABLE rides ADD COLUMN anonymized_at TEXT;

-- As antigas contas de demonstração tinham credenciais conhecidas e ficam inutilizadas.
DELETE FROM sessions WHERE user_id IN ('aura-demo-passenger', 'aura-demo-driver');
UPDATE users
SET status = 'suspended',
    driver_status = CASE WHEN driver_status IS NULL THEN NULL ELSE 'suspended' END,
    phone = 'disabled-' || id,
    cpf = 'disabled-' || id,
    password_hash = 'disabled',
    password_salt = 'disabled',
    pix_key = NULL,
    pix_key_type = NULL,
    profile_photo = NULL,
    vehicle_photo = NULL,
    updated_at = CURRENT_TIMESTAMP
WHERE id IN ('aura-demo-passenger', 'aura-demo-driver');

UPDATE driver_locations
SET is_online = 0, latitude = 0, longitude = 0, updated_at = CURRENT_TIMESTAMP
WHERE driver_id IN ('aura-demo-passenger', 'aura-demo-driver');
