const jwt = require('jsonwebtoken');

// Enforce JWT_SECRET from environment, fail fast if missing
// This prevents fallback to hardcoded secret which is visible in source code
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('CRITICAL: JWT_SECRET environment variable is required but not set');
}

// Authentication middleware
// Verifies JWT token and attaches user context to request
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // SECURITY FIX: Removed ignoreExpiration flag
    // Now properly enforces JWT expiration - tokens expire at specified time
    // This prevents indefinite session hijacking from stolen tokens
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Add user details to request object
    req.user = decoded;
    next();
  } catch (error) {
    // SECURITY FIX: Sanitized error message
    // Do not leak token verification details to client
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Role authorization middleware
// Checks if authenticated user has required role(s)
const authorize = (roles = []) => {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized. User context missing.' });
    }

    // Role-based verification
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ error: `Forbidden. Requires role: ${roles.join(' or ')}` });
    }

    next();
  };
};

// SECURITY FIX: Proper admin authorization check
// This middleware is used for admin-only operations (delete patient, delete doctor, etc.)
// It now properly enforces ADMIN role requirement
const authorizeAdminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // Enforce ADMIN role - deny all non-admin access
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Admin only.' });
  }
  
  next();
};

module.exports = {
  authenticate,
  authorize,
  authorizeAdminOnly,
};
