import pg from 'pg';

const { Pool } = pg;

function mapRow(row) {
  if (!row) return null;

  return {
    transaction_id: row.transaction_id,
    account_id: row.account_id,
    amount: Number(row.amount),
    transaction_type: row.transaction_type,
    event_time: new Date(row.event_time).toISOString(),
    received_at: new Date(row.received_at).toISOString(),
    source_ip: row.source_ip,
    fds_detected: row.fds_detected,
    fds_rules: row.fds_rules ?? [],
  };
}

export function createPostgresTransactionRepository({
  connectionString,
  ssl = false,
} = {}) {
  if (!connectionString) {
    throw new Error('DATABASE_URL is required for the PostgreSQL repository.');
  }

  const pool = new Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

  return {
    async create(transaction) {
      const query = `
        INSERT INTO transactions (
          transaction_id, account_id, amount, transaction_type, event_time,
          received_at, source_ip, fds_detected, fds_rules
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING *;
      `;
      const values = [
        transaction.transaction_id,
        transaction.account_id,
        transaction.amount,
        transaction.transaction_type,
        transaction.event_time,
        transaction.received_at,
        transaction.source_ip,
        transaction.fds_detected,
        JSON.stringify(transaction.fds_rules),
      ];
      const result = await pool.query(query, values);
      return mapRow(result.rows[0]);
    },

    async findById(transactionId) {
      const result = await pool.query(
        'SELECT * FROM transactions WHERE transaction_id = $1;',
        [transactionId],
      );
      return mapRow(result.rows[0]);
    },

    async findByAccountId(accountId) {
      const result = await pool.query(
        `SELECT *
         FROM transactions
         WHERE account_id = $1
         ORDER BY event_time ASC;`,
        [accountId],
      );
      return result.rows.map(mapRow);
    },

    async ping() {
      await pool.query('SELECT 1;');
      return true;
    },

    async close() {
      await pool.end();
    },
  };
}
