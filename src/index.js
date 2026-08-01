/**
 * HTTP and WebSocket entrypoint for the Sportz real-time sports API.
 */
import express from 'express';
import http from 'http';
import { matchRouter } from './routes/matches.js';
import { attachWebSocketServer } from './ws/server.js';
import { securityMiddleware } from '../arcjet.js';

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

const app = express();
const server = http.createServer(app);

app.use(express.json());

/**
 * Health/root handler confirming the API process is up.
 * @param {import('express').Request} _req - Express request.
 * @param {import('express').Response} res - Express response.
 */
app.get('/', (_req, res) => {
  res.send('Hello from Express server!');
});

app.use(securityMiddleware());

app.use('/matches', matchRouter);

const { broadcastMatchCreated } = attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;

server.listen(PORT, HOST, () => {
  const baseUrl =
    HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Server is running on ${baseUrl}`);
  console.log(
    `WebSocket server is running on ${baseUrl.replace('http', 'ws')}/ws`,
  );
});
