PRAGMA foreign_keys = ON;

-- Revoga sessões emitidas pelas versões antigas, que podiam permanecer válidas
-- por mais tempo que a política atual. Todos entram novamente uma única vez.
DELETE FROM sessions;

-- Links antigos deixam de funcionar depois da atualização de segurança.
UPDATE password_reset_requests
SET status = 'expired', token_hash = NULL
WHERE status IN ('pending', 'approved');

-- Perfis que foram aprovados automaticamente no código antigo precisam passar
-- por uma verificação humana antes de voltar a enxergar chamadas de passageiros.
UPDATE users
SET driver_status = 'pending', updated_at = CURRENT_TIMESTAMP
WHERE driver_status = 'approved'
  AND status = 'active'
  AND deleted_at IS NULL;

UPDATE driver_locations
SET is_online = 0, latitude = 0, longitude = 0, updated_at = CURRENT_TIMESTAMP;
