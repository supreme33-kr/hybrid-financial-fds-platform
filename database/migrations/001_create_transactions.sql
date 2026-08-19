CREATE TABLE IF NOT EXISTS transactions (
  transaction_id UUID PRIMARY KEY,
  account_id VARCHAR(30) NOT NULL,
  amount BIGINT NOT NULL CHECK (amount > 0),
  transaction_type VARCHAR(12) NOT NULL CHECK (
    transaction_type IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER')
  ),
  event_time TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_ip INET NULL,
  fds_detected BOOLEAN NOT NULL DEFAULT FALSE,
  fds_rules JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_event_time
  ON transactions (account_id, event_time DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_fds_detected
  ON transactions (fds_detected)
  WHERE fds_detected = TRUE;
