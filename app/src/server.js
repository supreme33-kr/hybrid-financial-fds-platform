import { buildApp } from './app.js';

const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const trustedProxyCidrs = (process.env.TRUSTED_PROXY_CIDRS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const app = buildApp({
  logger: true,
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: process.env.DATABASE_SSL === 'true',
  // Example production value: "10.1.93.55/32" for the HAProxy VM only.
  // Do not use trustProxy=true in a real deployment.
  trustProxy: trustedProxyCidrs.length > 0 ? trustedProxyCidrs : false,
});

try {
  await app.listen({ host: '0.0.0.0', port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
