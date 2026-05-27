const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const { requireJwtSecret } = require('./config/jwt');

try {
  requireJwtSecret();
} catch (err) {
  console.error('[STARTUP] JWT configuration error:', err.message);
  process.exit(1);
}

const authRoutes = require('./routes/auth');
const patientRoutes = require('./routes/patients');
const doctorRoutes = require('./routes/doctors');
const appointmentRoutes = require('./routes/appointments');
const queueRoutes = require('./routes/queue');
const reportRoutes = require('./routes/reports');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: [
    "https://haqmsfrontend.vercel.app",
    "http://localhost:3000"
  ],
  credentials: true
}));
app.use(express.json({ limit: '100kb' }));

// Lightweight rate limiting for auth endpoints (in-memory, per-process).
// Keeps normal login flows working while reducing brute force / spraying.
const authRateState = new Map();
function authRateLimit(req, res, next) {
  const windowMs = 60_000;
  const maxReq = 25;
  const key = `${req.ip}:${req.path}`;
  const now = Date.now();
  const entry = authRateState.get(key) || { start: now, count: 0 };

  if (now - entry.start >= windowMs) {
    entry.start = now;
    entry.count = 0;
  }

  entry.count += 1;
  authRateState.set(key, entry);

  if (entry.count > maxReq) {
    return res.status(429).json({ error: 'Too many requests. Please try again shortly.' });
  }

  next();
}

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

app.use('/api/auth', authRateLimit, authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/reports', reportRoutes);

app.get('/', (req, res) => {
  res.json({
    message: 'Hospital Appointment and Queue Management System (HAQMS) Backend API',
    status: 'Running',
    version: '1.0.0',
  });
});

app.use((err, req, res, next) => {
  console.error('[CRITICAL-ERROR]', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const statusCode = err.statusCode && err.statusCode >= 400 && err.statusCode < 600
    ? err.statusCode
    : 500;

  res.status(statusCode).json({
    message: 'An unexpected internal server error occurred.',
  });
});

app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`   HAQMS BACKEND SERVER IS RUNNING ON PORT ${PORT}`);
  console.log(`   ENVIRONMENT: ${process.env.NODE_ENV || 'development'}`);
  console.log(`===================================================`);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
