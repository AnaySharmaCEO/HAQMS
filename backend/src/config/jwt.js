/**
 * Central JWT configuration. Fails fast at startup if misconfigured.
 */

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length < 32) {
    throw new Error(
      'JWT_SECRET environment variable is required and must be at least 32 characters.'
    );
  }
  return secret.trim();
}

/** Default 8h — long enough for a hospital shift without the prior 365d exposure window. */
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

module.exports = {
  requireJwtSecret,
  JWT_EXPIRES_IN,
};
