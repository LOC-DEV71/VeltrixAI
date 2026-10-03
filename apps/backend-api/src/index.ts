import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { vietnameseResponses } from './middlewares/vietnameseResponses';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import {createServer} from 'node:http';
import {attachBillingRealtime} from './services/BillingRealtime';

if (!process.env.MONGODB_URI) {
  console.error("FATAL: MONGODB_URI is not set in environment.");
  process.exit(1);
}

const parseTrustProxy = (val?: string) => {
  if (!val || val === 'false') return false;
  if (val === 'true') return true;
  // Basic validation for IP list
  if (/^(\d{1,3}\.){3}\d{1,3}(,\s*(\d{1,3}\.){3}\d{1,3})*$/.test(val)) {
    return val.split(',').map(s => s.trim());
  }
  throw new Error(`Invalid TRUST_PROXY configuration: ${val}. Must be 'false', 'true', or comma-separated IPv4 addresses.`);
};

import authRoutes from './routes/auth';
import projectsRoutes from './routes/projects';
import contentsRoutes from './routes/contents';

import './workers/ContentWorker';

const app = express();
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));



const port = process.env.PORT || 3001;

// Middlewares
app.use(helmet());
const corsOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : false;
console.log('CORS Origins:', corsOrigins);
app.use(cors({ 
  origin: corsOrigins, 
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-request-id', 'Idempotency-Key'],
  exposedHeaders: ['x-csrf-token']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(vietnameseResponses);

app.use('/api/v1/auth', authRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/contents', contentsRoutes);
app.use('/api/developer', require('./routes/developer').default);
app.use('/api/users', require('./routes/users').default);
app.use('/api/jobs', require('./routes/jobs').default);
app.use('/api/voices', require('./routes/voices').default);
app.use('/api/voice-enrollments', require('./routes/voiceEnrollments').default);
app.use('/api/scenes', require('./routes/scenes').default);
app.use('/api/media', require('./routes/media').default);
app.use('/api/plans', require('./routes/plans').default);
app.use('/api/billing', require('./routes/billing').default);
app.use('/api/notifications', require('./routes/notifications').default);
app.use('/api/admin/auth', require('./routes/adminAuth').default);
app.use('/api/admin/control',require('./routes/adminControl').default);
app.use('/api/admin/plans', require('./routes/adminPlans').default);
app.use('/api/admin/voices', require('./routes/adminVoices').default);
app.use('/api/admin/users', require('./routes/adminUsers').default);
app.use('/api/admin/billing', require('./routes/adminBilling').default);
app.use('/api/tts', require('./routes/tts').default);

// Request ID middleware mock
app.use((req, res, next) => {
  req.headers['x-request-id'] = req.headers['x-request-id'] || crypto.randomUUID();
  next();
});

// Structured Logging mock
app.use((req, res, next) => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url.split('?')[0], // Don't log query params containing sensitive data
    requestId: req.headers['x-request-id']
  }));
  next();
});

// Health checks
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/health/ready', (req, res) => {
  // Mock readiness check for Mongo/Redis
  const isReady = process.env.NODE_ENV !== 'production' || (process.env.MONGODB_URI && process.env.REDIS_URI);
  if (isReady) {
    res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'not_ready', error: 'Dependencies unavailable' });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});

// Centralized error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(JSON.stringify({ error: err.message, stack: err.stack }));
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal Server Error' } });
});

import mongoose from 'mongoose';

const server = createServer(app);
const billingSockets=attachBillingRealtime(server,[...(Array.isArray(corsOrigins)?corsOrigins:[]),...(process.env.NODE_ENV==='production'?[]:['http://localhost:5173','http://localhost:5174'])]);
server.listen(port, async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI as string);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
  }
  console.log(`Backend API listening on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully.');
  billingSockets.close();
  server.close(() => {
    console.log('Server closed.');
    process.exit(0);
  });
});

export { app };
