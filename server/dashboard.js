'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const autoReplies = require('../utils/autoReplies');
const logger = require('../utils/logger');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function readBody(req, maxBytes = 1_000_000) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        req.destroy();
        reject(new Error('body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * @param {{ port?: number, host?: string }} [options]
 */
function startDashboard(options = {}) {
  const port = Number(process.env.PORT || options.port || 3000);
  const host = process.env.HOST || options.host || '0.0.0.0';

  let latestQr = null;
  let connectionState = 'connecting';
  const sseClients = new Set();

  function sseBroadcast(event, payload) {
    const data = JSON.stringify(payload);
    const msg = `event: ${event}\ndata: ${data}\n\n`;
    for (const res of sseClients) {
      try {
        res.write(msg);
      } catch {
        sseClients.delete(res);
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = u.pathname;

      if (pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('\n');
        sseClients.add(res);
        const init = JSON.stringify({ qr: latestQr, connection: connectionState });
        res.write(`event: init\ndata: ${init}\n\n`);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (pathname === '/api/auto-replies' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(autoReplies.listReplies()));
        return;
      }

      if (pathname === '/api/auto-replies' && req.method === 'POST') {
        let body = '{}';
        try {
          body = await readBody(req);
        } catch (e) {
          res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: e.message }));
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'invalid JSON' }));
          return;
        }
        try {
          const row = autoReplies.addReply(parsed);
          res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(row));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: e.message || String(e) }));
        }
        return;
      }

      if (pathname === '/api/auto-replies' && req.method === 'DELETE') {
        const id = u.searchParams.get('id');
        if (!id) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'missing id query param' }));
          return;
        }
        const ok = autoReplies.removeReply(id);
        if (!ok) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }
        res.writeHead(204);
        res.end();
        return;
      }

      if (pathname === '/' || pathname === '/index.html') {
        const htmlPath = path.join(PUBLIC_DIR, 'index.html');
        if (!fs.existsSync(htmlPath)) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Dashboard HTML missing (public/index.html)');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(htmlPath, 'utf8'));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(err.message || String(err));
    }
  });

  server.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    logger.info(`Web dashboard: http://${displayHost}:${port}`);
  });

  return {
    setQr(qr) {
      latestQr = qr || null;
      sseBroadcast('qr', { qr: latestQr });
    },
    setConnection(state) {
      connectionState = state != null ? String(state) : 'connecting';
      sseBroadcast('connection', { connection: connectionState });
    },
    getAddress() {
      return { host, port };
    },
    close() {
      return new Promise((resolve, reject) => {
        for (const res of sseClients) {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
        sseClients.clear();
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

module.exports = { startDashboard };
