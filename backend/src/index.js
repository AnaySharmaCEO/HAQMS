const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Validate critical environment variables on startup
// This prevents silent failures from misconfiguration
if (!process.env.JWT_SECRET) {
  console.error('CRITICAL: JWT_SECRET environment variable is not set');
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

// Enable CORS for all origins (weak/broad CORS config)
app.use(cors());

// Body parser
app.use(express.json());

// Simple request logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Register routes
app.use('/api/auth', authRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/queue', queueRoutes);
app.use('/api/reports', reportRoutes);

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Hospital Appointment and Queue Management System (HAQMS) Backend API',
    status: 'Running',
    version: '1.0.0'
  });
});

// GLOBAL ERROR HANDLER
// SECURITY FIX: Prevent stack trace and internal detail leakage
// - Server-side: Full error logged for debugging and monitoring
// - Client-side: Generic error message returned
// This balance preserves observability while protecting against information disclosure
app.use((err, req, res, next) => {
  console.error('[CRITICAL-ERROR]:', err);
  
  // Return generic error to client - do not expose internals
  res.status(500).json({
    message: 'An unexpected internal server error occurred.',
    // Stack traces only in development if explicitly enabled
    ...(process.env.NODE_ENV === 'development' && process.env.DEBUG_STACK === 'true' && { error: err.message }),
  });
});

// Listen on port
app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`   HAQMS BACKEND SERVER IS RUNNING ON PORT ${PORT}`);
  console.log(`   ENVIRONMENT: ${process.env.NODE_ENV || 'development'}`);
  console.log(`===================================================`);
});

// Catch unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Log but don't exit - allows graceful degradation in some scenarios
});
