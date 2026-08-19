const KST_OFFSET_MINUTES = 9 * 60;

function isValidDate(value) {
  return Number.isFinite(Date.parse(value));
}

function getKstHour(timestamp) {
  const milliseconds = Date.parse(timestamp);
  const kst = new Date(milliseconds + KST_OFFSET_MINUTES * 60 * 1000);
  return kst.getUTCHours();
}

function isWithinWindow(timestamp, referenceTimestamp, windowMs) {
  const target = Date.parse(timestamp);
  const reference = Date.parse(referenceTimestamp);
  return target <= reference && target >= reference - windowMs;
}

export function createFdsService({ transactionRepository }) {
  return {
    async evaluate(transaction) {
      if (!isValidDate(transaction.event_time)) {
        throw new Error('event_time must be a valid ISO 8601 timestamp');
      }

      const detections = [];
      const history = await transactionRepository.findByAccountId(transaction.account_id);
      const relevantTransactions = [...history, transaction];

      // R01: same account, at least 3 withdrawals within the latest 60 seconds.
      const withdrawalsIn60Seconds = relevantTransactions.filter(
        (item) =>
          item.transaction_type === 'WITHDRAWAL' &&
          isWithinWindow(item.event_time, transaction.event_time, 60 * 1000),
      );
      if (withdrawalsIn60Seconds.length >= 3) {
        detections.push({
          rule_id: 'R01',
          rule_name: 'REPEAT_WITHDRAWAL',
          reason: '3 or more withdrawals within 60 seconds for the same account',
        });
      }

      // R02: high amount transaction.
      if (transaction.amount >= 1_000_000) {
        detections.push({
          rule_id: 'R02',
          rule_name: 'HIGH_AMOUNT',
          reason: 'amount >= 1000000 KRW',
        });
      }

      // R04: 00:00-05:00 KST and high amount transaction.
      const kstHour = getKstHour(transaction.event_time);
      if (kstHour >= 0 && kstHour < 5 && transaction.amount >= 500_000) {
        detections.push({
          rule_id: 'R04',
          rule_name: 'LATE_NIGHT_HIGH_AMOUNT',
          reason: '00:00-05:00 KST and amount >= 500000 KRW',
        });
      }

      // R07: same account, at least 5 low-value transfers within the latest 10 minutes.
      const smallTransfersIn10Minutes = relevantTransactions.filter(
        (item) =>
          item.transaction_type === 'TRANSFER' &&
          item.amount <= 100_000 &&
          isWithinWindow(item.event_time, transaction.event_time, 10 * 60 * 1000),
      );
      if (smallTransfersIn10Minutes.length >= 5) {
        detections.push({
          rule_id: 'R07',
          rule_name: 'SMALL_TRANSFER_SPLIT',
          reason: '5 or more transfers of 100000 KRW or less within 10 minutes for the same account',
        });
      }

      return detections;
    },
  };
}
