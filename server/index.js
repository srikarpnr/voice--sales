import http from 'node:http';
import path from 'node:path';
import express from 'express';
import mongoose from 'mongoose';
import { WebSocketServer } from 'ws';
import { connectDb } from './db.js';
import { api } from './routes.js';
import { verifyToken } from './auth.js';
import { startCall } from './call.js';

const REQUIRED_ENV = ['MONGODB_URI', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'GNANI_API_KEY', 'OPENROUTER_API_KEY', 'LLM_MODEL', 'EMBED_MODEL'];
const missing = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Set these in .env first: ${missing.join(', ')}`);
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 4000;
const clientDir = path.resolve(import.meta.dirname, '../client');

await connectDb(process.env.MONGODB_URI);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));
app.use('/api', api);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use('/api', (err, req, res, next) => {
  const status = err.status ?? (['CastError', 'ValidationError'].includes(err.name) ? 400 : 500);
  if (status >= 500) console.error(err);
  const message = err.name === 'CastError' ? 'Invalid id' : err.message;
  res.status(status).json({ error: status >= 500 ? 'Something went wrong on the server' : message });
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(clientDir, 'dist')));
  app.get('/*splat', (req, res) => res.sendFile(path.join(clientDir, 'dist', 'index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: clientDir, server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

const server = http.createServer(app);

// Browsers cannot set an Authorization header on a WebSocket, so the client offers the
// subprotocols ["bearer", <token>]; a URL would leak the token into access logs.
const calls = new WebSocketServer({
  server,
  path: '/ws/call',
  maxPayload: 64 * 1024,
  handleProtocols: (protocols) => (protocols.has('bearer') ? 'bearer' : false),
});
calls.on('connection', (ws, req) => {
  const [scheme, token] = (req.headers['sec-websocket-protocol'] ?? '').split(',').map((p) => p.trim());
  if (scheme !== 'bearer' || !verifyToken(token)) return ws.close(4401, 'Please log in again');
  const leadId = new URL(req.url, 'http://localhost').searchParams.get('lead');
  if (!mongoose.isValidObjectId(leadId)) return ws.close(4400, 'Unknown lead');
  startCall(ws, leadId).catch((err) => {
    console.error('Call could not start:', err);
    ws.close(1011, 'Could not start the call');
  });
});

server.listen(PORT, () => console.log(`Voice sales agent running at http://localhost:${PORT}`));
