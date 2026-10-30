/**
 * Seeds the local test stack started by `npm run test:start`.
 * Uses the fixed admin credentials from docker-compose.test.yml.
 */
process.env.DIRECTUS_URL ||= 'http://localhost:8160';
process.env.DIRECTUS_ADMIN_EMAIL ||= 'admin@example.com';
process.env.DIRECTUS_ADMIN_PASSWORD ||= 'test-password';

await import('../examples/manual-demo.mjs');
