import { WebSocketServer, WebSocket } from 'ws';
import { wsArcjet } from '../../arcjet.js';

const HEARTBEAT_INTERVAL_MS = 30_000;

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
function broadcast(wss, payload) {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;

    client.send(JSON.stringify(payload));
  }
}

/**
 * Attach a WebSocket server to an HTTP server for real-time match events.
 * Uses protocol-level ping/pong heartbeats to drop dead connections.
 * @param {import('http').Server} server - HTTP server instance to upgrade.
 * @returns {{ broadcastMatchCreated: (match: object) => void }} Helpers for publishing events.
 */
export function attachWebSocketServer(server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
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

  wss.on('connection', async (socket, req) => {
    if (wsArcjet) {
      try {
        const decision = await wsArcjet.protect(req);

        if (decision.isDenied()) {
          const code = decision.reason.isRateLimit() ? 1013 : 1008;
          const reason = decision.reason.isRateLimit()
            ? 'Rate limit exceeded'
            : 'Access denied';
          socket.close(code, reason);
          return;
        }
      } catch (error) {
        console.error('WS connection error', error);
        socket.close(1011, 'Server security error');
        return;
      }
    }

    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

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
    broadcast(wss, { type: 'match_created', data: match });
  }

  return { broadcastMatchCreated };
}
