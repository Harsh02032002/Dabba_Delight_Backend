const path = require('path');
const fs = require('fs');

/**
 * Returns JWT_SECRET from env. If not set, reads .env from backend folder and sets it (line + regex fallback).
 */
function getJwtSecret() {
  let secret = process.env.JWT_SECRET;
  if (secret && String(secret).trim() !== '') return secret.trim();

  const envPath = path.resolve(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    let content = fs.readFileSync(envPath, 'utf8');
    if (!content || content.length < 5) try { content = fs.readFileSync(envPath, 'utf16le'); } catch (_) {}
    if (content) {
      const m = content.match(/JWT_SECRET\s*=\s*([^\r\n#]+)/);
      if (m) {
        secret = m[1].trim();
        process.env.JWT_SECRET = secret;
        return secret;
      }
    }
  }

  throw new Error('Server misconfiguration: JWT_SECRET is not set. Add JWT_SECRET=your_secret to .env in the backend folder and restart the server.');
}

module.exports = { getJwtSecret };
