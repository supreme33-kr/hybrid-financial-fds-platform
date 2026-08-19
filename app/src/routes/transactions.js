import { randomUUID } from 'node:crypto';

export const transactionBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['account_id', 'amount', 'transaction_type', 'event_time'],
  properties: {
    account_id: {
      type: 'string',
      minLength: 3,
      maxLength: 30,
      pattern: '^[A-Z0-9_-]+$',
    },
    amount: {
      type: 'integer',
      minimum: 1,
      maximum: 1_000_000_000,
    },
    transaction_type: {
      type: 'string',
      enum: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER'],
    },
    event_time: {
      type: 'string',
      minLength: 20,
      maxLength: 40,
    },
  },
};

function isIso8601WithOffset(value) {
  if (typeof value !== 'string') return false;
  const hasTimezone = /(Z|[+-]\d{2}:\d{2})$/.test(value);
  return hasTimezone && Number.isFinite(Date.parse(value));
}

function validationError(reply, message, requestId) {
  return reply.code(400).send({
    error: {
      code: 'VALIDATION_ERROR',
      message,
      request_id: requestId,
    },
  });
}

function resolveSourceIp(request, trustedProxyConfigured) {
  if (!trustedProxyConfigured || !request.headers['x-forwarded-for']) {
    return null;
  }

  // Fastify resolves request.ip after applying the application's trustProxy allowlist.
  return request.ip ?? null;
}

export async function transactionRoutes(fastify, options) {
  const {
    transactionRepository,
    fdsService,
    metrics,
    trustedProxyConfigured = false,
  } = options;

  fastify.post(
    '/transactions',
    {
      schema: {
        body: transactionBodySchema,
      },
    },
    async (request, reply) => {
      const endTimer = metrics.transactionProcessingDuration.startTimer();

      try {
        const body = request.body;
        if (!isIso8601WithOffset(body.event_time)) {
          return validationError(
            reply,
            'event_time must be a valid ISO 8601 timestamp with timezone offset',
            request.id,
          );
        }

        const sourceIp = resolveSourceIp(request, trustedProxyConfigured);
        if (!sourceIp) {
          metrics.missingClientIp.inc();
        }

        const fdsRules = await fdsService.evaluate(body);
        const transaction = {
          transaction_id: randomUUID(),
          account_id: body.account_id,
          amount: body.amount,
          transaction_type: body.transaction_type,
          event_time: body.event_time,
          received_at: new Date().toISOString(),
          source_ip: sourceIp,
          fds_detected: fdsRules.length > 0,
          fds_rules: fdsRules,
        };

        const persisted = await transactionRepository.create(transaction);
        metrics.transactionSaveSuccess.inc();
        for (const rule of fdsRules) {
          metrics.fdsDetection.inc({ rule_id: rule.rule_id });
        }

        return reply.code(201).send(persisted);
      } catch (error) {
        request.log.error({ err: error }, 'transaction persistence failed');
        metrics.transactionSaveFailure.inc();
        return reply.code(503).send({
          error: {
            code: 'DATABASE_UNAVAILABLE',
            message: 'Transaction could not be persisted. Please retry later.',
            request_id: request.id,
          },
        });
      } finally {
        endTimer();
      }
    },
  );

  fastify.get('/transactions/:transactionId', async (request, reply) => {
    const transaction = await transactionRepository.findById(
      request.params.transactionId,
    );

    if (!transaction) {
      return reply.code(404).send({
        error: {
          code: 'TRANSACTION_NOT_FOUND',
          message: 'The requested transaction does not exist.',
          request_id: request.id,
        },
      });
    }

    return reply.send(transaction);
  });
}
