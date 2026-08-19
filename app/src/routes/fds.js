import { transactionBodySchema } from './transactions.js';

function isIso8601WithOffset(value) {
  if (typeof value !== 'string') return false;
  return /(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}

export async function fdsRoutes(fastify, { fdsService }) {
  fastify.post(
    '/fds/check',
    {
      schema: {
        body: transactionBodySchema,
      },
    },
    async (request, reply) => {
      if (!isIso8601WithOffset(request.body.event_time)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'event_time must be a valid ISO 8601 timestamp with timezone offset',
            request_id: request.id,
          },
        });
      }

      const fdsRules = await fdsService.evaluate(request.body);
      return reply.send({
        account_id: request.body.account_id,
        fds_detected: fdsRules.length > 0,
        fds_rules: fdsRules,
      });
    },
  );
}
