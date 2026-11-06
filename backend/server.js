require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const helmet = require('helmet');
const http = require('http');

const { errorHandler } = require('./src/middleware/errorHandler');
const { apiLimiter } = require('./src/middleware/rateLimiter');

const authRoutes = require('./src/routes/auth');
const userRoutes = require('./src/routes/users');
const { authenticate } = require('./src/middleware/auth');

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGIN = process.env.FRONTEND_URL || 'http://localhost:5173';

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── Socket.io ─────────────────────────────────────────────────────────────────

// ── Core middleware ───────────────────────────────────────────────────────────
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Global rate limit on all API routes
app.use('/api', apiLimiter);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) =>
  res.json({ status: 'ok', service: 'SCMU API', version: '1.0.0' })
);

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/portal', (req, res) => res.status(404).json({ message: 'Customer portal is no longer available' }));
app.use('/api', authenticate);
app.use('/api/bl-register', require('./src/routes/blRegister'));
app.use('/api/journeys', require('./src/routes/journeys'));
app.use('/api/journeys', require('./src/routes/journeyBillRecap'));
app.use('/api/routes', require('./src/routes/routes'));
app.use('/api/goods', require('./src/routes/goods'));
app.use('/api/operating-cost-types', require('./src/routes/operatingCostTypes'));
app.use('/api/driver-trips', require('./src/routes/driverTrips'));
app.use('/api/fleet', require('./src/routes/fleet'));
app.use('/api/drivers', require('./src/routes/drivers'));
app.use('/api/vessels', require('./src/routes/vessels'));
app.use('/api/bl-imports', require('./src/routes/blImports'));
app.use('/api/operations', require('./src/routes/operations'));
app.use('/api/jpt-tariffs', require('./src/routes/jptTariffs'));
app.use('/api/approvals', require('./src/routes/approvals'));
app.use('/api/companies', require('./src/routes/companies'));
app.use('/api/users', userRoutes);

// NOTE: /uploads is NOT served as static — files are served via authenticated
// endpoint in shipments route to prevent unauthenticated access.

// ── Socket.io: require auth token ────────────────────────────────────────────

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  require('./src/services/documentFilePurge').startWorker();
  if (process.env.NODE_ENV !== 'production') {
    console.log(`\n🚛 SCMU API running on port ${PORT}`);
    console.log(`📖 Health check: http://localhost:${PORT}/health\n`);
  }
});

module.exports = { app };
