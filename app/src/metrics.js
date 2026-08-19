import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export function createMetrics() {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry, prefix: 'nodejs_' });

  const transactionSaveSuccess = new Counter({
    name: 'transaction_save_success_total',
    help: 'Total number of successfully persisted transactions.',
    registers: [registry],
  });

  const transactionSaveFailure = new Counter({
    name: 'transaction_save_failure_total',
    help: 'Total number of transaction persistence failures.',
    registers: [registry],
  });

  const fdsDetection = new Counter({
    name: 'fds_detection_total',
    help: 'Total number of FDS detections by rule.',
    labelNames: ['rule_id'],
    registers: [registry],
  });

  const missingClientIp = new Counter({
    name: 'missing_client_ip_total',
    help: 'Total number of requests without a client IP from the trusted proxy path.',
    registers: [registry],
  });

  const transactionProcessingDuration = new Histogram({
    name: 'transaction_processing_duration_seconds',
    help: 'Duration of transaction request processing in seconds.',
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
    registers: [registry],
  });

  return {
    registry,
    transactionSaveSuccess,
    transactionSaveFailure,
    fdsDetection,
    missingClientIp,
    transactionProcessingDuration,
  };
}
