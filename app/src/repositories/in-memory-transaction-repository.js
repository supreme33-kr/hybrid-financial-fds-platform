export function createInMemoryTransactionRepository() {
  const transactions = [];

  return {
    async create(transaction) {
      transactions.push(structuredClone(transaction));
      return structuredClone(transaction);
    },

    async findById(transactionId) {
      const transaction = transactions.find(
        (item) => item.transaction_id === transactionId,
      );
      return transaction ? structuredClone(transaction) : null;
    },

    async findByAccountId(accountId) {
      return transactions
        .filter((item) => item.account_id === accountId)
        .map((item) => structuredClone(item));
    },
  };
}
