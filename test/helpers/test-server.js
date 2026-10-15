/**
 * Boots the real server.js against an isolated in-memory MongoDB replica set for HTTP tests.
 * Never touches a real database or third-party account: all external keys are blanked.
 *
 * Usage (spawned by tests): node test/helpers/test-server.js <port>
 * Prints one line `TEST_SERVER_READY {"port":..,"mongoUri":".."}` once it accepts requests.
 */
const path = require('path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

(async () => {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const mongoUri = replSet.getUri('dabba_e2e');

  process.env.MONGO_URI = mongoUri;
  process.env.PORT = process.argv[2] || '5099';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'e2e-test-secret';
  delete process.env.ALLOW_DB_SEED;
  delete process.env.SERVICE_RADIUS_KM;
  for (const k of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'RAZORPAY_VIRTUAL_ACCOUNT',
    'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'EMAIL_USER', 'EMAIL_PASS', 'GEMINI_API_KEY',
    'STRIPE_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY', 'AWS_ACCESS_KEY_ID']) {
    process.env[k] = 'test-disabled';
  }
  // Razorpay test-mode style keys: signatures are checked locally, no network calls are made in tests
  process.env.RAZORPAY_KEY_ID = 'rzp_test_e2e';
  process.env.RAZORPAY_KEY_SECRET = 'e2e-razorpay-secret';
  process.env.EMAIL_HOST = '127.0.0.1';
  process.env.EMAIL_PORT = '9';

  const backendDir = path.join(__dirname, '..', '..');
  process.chdir(backendDir);
  require(path.join(backendDir, 'server.js'));

  const mongoose = require('mongoose');
  await new Promise((r) => (mongoose.connection.readyState === 1 ? r() : mongoose.connection.once('open', r)));

  // Wait until HTTP is up
  const port = Number(process.env.PORT);
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.status < 500) break;
    } catch (_) { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  process.stdout.write(`TEST_SERVER_READY ${JSON.stringify({ port, mongoUri })}\n`);

  const shutdown = async () => {
    try { await mongoose.disconnect(); } catch (_) {}
    try { await replSet.stop(); } catch (_) {}
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('message', (m) => { if (m === 'shutdown') shutdown(); });
})().catch((e) => {
  console.error('test-server failed', e);
  process.exit(1);
});
