import { WebSocketServer, WebSocket } from 'ws';
import {
  hasMissingUserAgent,
  isArcjetErrored,
  wsArcjet,
} from '../../arcjet.js';

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_MATCH_SUBSCRIPTIONS = 50;

const matchSubscribers = new Map();

function subscribe(matchId, socket) {
  if (!matchSubscribers.has(matchId)) {
    matchSubscribers.set(matchId, new Set());
  }

  matchSubscribers.get(matchId).add(socket);
}

function unsubscribe(matchId, socket) {
  const subscribers = matchSubscribers.get(matchId);

  if (!subscribers) return;

  subscribers.delete(socket);

  if (subscribers.size === 0) {
    matchSubscribers.delete(matchId);
  }
}

function cleanupSubscriptions(socket) {
  for (const matchId of socket.subscriptions) {
    unsubscribe(matchId, socket);
  }
}

/**
 * Send a JSON payload over an open WebSocket connection.
 * @param {import('ws').WebSocket} socket - Connected client socket.
 * @param {object} payload - Value to serialize and send.
 */
function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;

  socket.send(JSON.stringify(payload));
}

/**
 * Broadcast a JSON payload to every open WebSocket client.
 * @param {import('ws').WebSocketServer} wss - Active WebSocket server.
 * @param {object} payload - Value to serialize and send.
 */
function broadcastToAll(wss, payload) {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    client.send(JSON.stringify(payload));
  }
}

function broadcastToMatch(matchId, payload) {
  const subscribers = matchSubscribers.get(matchId);

  if (!subscribers || subscribers.size === 0) return;

  const message = JSON.stringify(payload);

  for (const client of subscribers) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function handleMessage(socket, data) {
  let message;

  try {
    message = JSON.parse(data.toString());
  } catch (error) {
    sendJson(socket, { type: 'error', message: 'Invalid JSON' });
  }

  if (message?.type === 'subscribe' && Number.isInteger(message.matchId)) {
    if (socket.subscriptions.has(message.matchId)) {
      sendJson(socket, { type: 'subscribed', matchId: message.matchId });
      return;
    }

    if (socket.subscriptions.size >= MAX_MATCH_SUBSCRIPTIONS) {
      sendJson(socket, {
        type: 'error',
        message: 'Subscription limit reached',
      });
      return;
    }

    subscribe(message.matchId, socket);
    socket.subscriptions.add(message.matchId);
    sendJson(socket, { type: 'subscribed', matchId: message.matchId });
    return;
  }

  if (message?.type === 'unsubscribe' && Number.isInteger(message.matchId)) {
    unsubscribe(message.matchId, socket);
    socket.subscriptions.delete(message.matchId);
    sendJson(socket, { type: 'unsubscribed', matchId: message.matchId });
    return;
  }
}

/**
 * Write an HTTP error response and destroy the upgrade socket.
 * @param {import('stream').Duplex} socket - Raw TCP socket from the upgrade event.
 * @param {number} status - HTTP status code.
 * @param {string} message - Reason phrase.
 */
function rejectUpgrade(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

/**
 * Attach a WebSocket server to an HTTP server for real-time match events.
 * Uses protocol-level ping/pong heartbeats to drop dead connections.
 * @param {import('http').Server} server - HTTP server instance to upgrade.
 * @returns {{ broadcastMatchCreated: (match: object) => void }} Helpers for publishing events.
 */
export function attachWebSocketServer(server) {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }

      client.isAlive = false;
      client.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  server.on('upgrade', async (req, socket, head) => {
    const { pathname } = new URL(req.url || '/', 'http://localhost');
    if (pathname !== '/ws') {
      socket.destroy();
      return;
    }

    if (wsArcjet) {
      try {
        const decision = await wsArcjet.protect(req);

        if (hasMissingUserAgent(decision)) {
          rejectUpgrade(socket, 403, 'Forbidden');
          return;
        }

        if (isArcjetErrored(decision)) {
          rejectUpgrade(socket, 503, 'Service Unavailable');
          return;
        }

        if (decision.isDenied()) {
          if (decision.reason.isRateLimit()) {
            rejectUpgrade(socket, 429, 'Too Many Requests');
            return;
          }

          rejectUpgrade(socket, 403, 'Forbidden');
          return;
        }
      } catch (error) {
        console.error('WS upgrade error', error);
        rejectUpgrade(socket, 503, 'Service Unavailable');
        return;
      }
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (socket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.subscriptions = new Set();

    socket.on('message', (data) => handleMessage(socket, data));

    socket.on('error', () => socket.terminate());

    socket.on('close', () => cleanupSubscriptions(socket));

    sendJson(socket, { type: 'welcome' });

    socket.on('error', console.error);
  });

  wss.on('close', () => {
    clearInterval(heartbeat);
  });

  /**
   * Notify all clients that a new match was created.
   * @param {object} match - Newly created match record.
   */
  function broadcastMatchCreated(match) {
    broadcastToAll(wss, { type: 'match_created', data: match });
  }

  function broadcastCommentary(matchId, comment) {
    broadcastToMatch(matchId, { type: 'commentary', data: comment });
  }

  return { broadcastMatchCreated, broadcastCommentary };
}
