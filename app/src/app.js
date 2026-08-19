import Fastify from 'fastify';
import { createMetrics } from './metrics.js';
import { createInMemoryTransactionRepository } from './repositories/in-memory-transaction-repository.js';
import { createPostgresTransactionRepository } from './repositories/postgres-transaction-repository.js';
import { fdsRoutes } from './routes/fds.js';
import { transactionRoutes } from './routes/transactions.js';
import { createFdsService } from './services/fds-service.js';

export function buildApp({
  transactionRepository,
  databaseUrl,
  databaseSsl = false,
  trustProxy = false,
  logger = false,
} = {}) {
  const resolvedRepository = transactionRepository ?? (
    databaseUrl
      ? createPostgresTransactionRepository({
          connectionString: databaseUrl,
          ssl: databaseSsl,
        })
      : createInMemoryTransactionRepository()
  );
  const fastify = Fastify({
    logger,
    trustProxy,
    ajv: {
      customOptions: {
        // Server-owned fields such as source_ip must be rejected, not silently stripped.
        removeAdditional: false,
      },
    },
  });
  const metrics = createMetrics();
  const fdsService = createFdsService({
    transactionRepository: resolvedRepository,
  });
  const trustedProxyConfigured = Boolean(trustProxy);

  fastify.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: error.message,
          request_id: request.id,
        },
      });
    }

    request.log.error({ err: error }, 'unhandled application error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error.',
        request_id: request.id,
      },
    });
  });

  fastify.get('/health', async (_request, reply) => {
    try {
      if (typeof resolvedRepository.ping === 'function') {
        await resolvedRepository.ping();
      }
      return { status: 'UP' };
    } catch (error) {
      return reply.code(503).send({ status: 'DOWN', dependency: 'database' });
    }
  });

  fastify.get('/metrics', async (_request, reply) => {
    reply.type(metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  fastify.register(transactionRoutes, {
    prefix: '/api/v1',
    transactionRepository: resolvedRepository,
    fdsService,
    metrics,
    trustedProxyConfigured,
  });

  fastify.register(fdsRoutes, {
    prefix: '/api/v1',
    fdsService,
  });

  fastify.addHook('onClose', async () => {
    if (typeof resolvedRepository.close === 'function') {
      await resolvedRepository.close();
    }
  });

  return fastify;
}
