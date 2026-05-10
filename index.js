'use strict';

/**
 * WhatsApp bot entry with multi-session support.
 * Each session has its own auth directory and QR lifecycle.
 */

const fs = require('fs');
const path = require('path');
const pino = require('pino');

const logger = require('./utils/logger');
const { handleIncomingMessage } = require('./handlers/commands');
const { startDashboard } = require('./server/dashboard');

const config = {
  commandPrefix: process.env.COMMAND_PREFIX || '',
  authRoot: process.env.AUTH_DIR
    ? path.resolve(process.env.AUTH_DIR)
    : path.join(__dirname, 'auth'),
  sessionsDirName: 'sessions',
};

let dashboard = null;
const sessions = new Map();
let baileysCache = null;

function sanitizeSessionId(raw) {
  const base = String(raw || '').trim().toLowerCase();
  if (!base) return '';
  return base.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

function getSessionsRootDir() {
  return path.join(config.authRoot, config.sessionsDirName);
}

function getSessionAuthDir(sessionId) {
  return path.join(getSessionsRootDir(), sessionId);
}

function ensureAuthDirs() {
  fs.mkdirSync(config.authRoot, { recursive: true });
  fs.mkdirSync(getSessionsRootDir(), { recursive: true });
}

function listSessionViews() {
  const out = [];
  for (const session of sessions.values()) {
    out.push({
      id: session.id,
      connection: session.connectionState,
      qr: session.qr,
      authDir: session.authDir,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function publishSessions() {
  if (dashboard) dashboard.setSessions(listSessionViews());
}

function clearSessionReconnectTimer(session) {
  if (session.reconnectTimer) {
    clearTimeout(session.reconnectTimer);
    session.reconnectTimer = null;
  }
}

function scheduleSessionReconnect(session, fn, delayMs = 3500) {
  clearSessionReconnectTimer(session);
  session.reconnectTimer = setTimeout(() => {
    session.reconnectTimer = null;
    fn().catch((e) => logger.error(`Reconnect failed (${session.id})`, e?.message || e));
  }, delayMs);
}

async function loadBaileys() {
  if (baileysCache) return baileysCache;
  const baileys = await import('@whiskeysockets/baileys');
  baileysCache = {
    makeWASocket: baileys.default,
    DisconnectReason: baileys.DisconnectReason,
    useMultiFileAuthState: baileys.useMultiFileAuthState,
    fetchLatestBaileysVersion: baileys.fetchLatestBaileysVersion,
    Browsers: baileys.Browsers,
  };
  return baileysCache;
}

function shouldReconnect(lastDisconnect, DisconnectReason) {
  try {
    const statusCode = lastDisconnect?.error?.output?.statusCode;
    if (statusCode === DisconnectReason.loggedOut) return false;
    return true;
  } catch {
    return true;
  }
}

function createSession(sessionId) {
  const id = sanitizeSessionId(sessionId);
  if (!id) {
    throw new Error('session id is required');
  }
  if (sessions.has(id)) {
    return sessions.get(id);
  }

  const session = {
    id,
    authDir: getSessionAuthDir(id),
    sock: null,
    qr: null,
    isStarting: false,
    reconnectTimer: null,
    connectionState: 'idle',
    autoReconnect: true,
  };
  fs.mkdirSync(session.authDir, { recursive: true });
  sessions.set(id, session);
  publishSessions();
  return session;
}

async function createSocket(session) {
  const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
  } = await loadBaileys();

  const { state, saveCreds } = await useMultiFileAuthState(session.authDir);

  let version;
  try {
    if (typeof fetchLatestBaileysVersion === 'function') {
      const v = await fetchLatestBaileysVersion();
      version = v?.version;
    }
  } catch {
    version = undefined;
  }

  const sock = makeWASocket({
    auth: state,
    version,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers?.macOS(`Baileys Bot ${session.id}`) || ['Baileys Bot', 'Chrome', '1.0.0'],
    markOnlineOnConnect: true,
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        session.qr = qr;
        logger.info(`Scan QR for session "${session.id}" in dashboard`);
        publishSessions();
      }

      if (connection) {
        session.connectionState = String(connection);
        publishSessions();
      }

      if (connection === 'open') {
        session.qr = null;
        session.connectionState = 'open';
        logger.info(`WhatsApp Connected (${session.id})`);
        publishSessions();
      }

      if (connection === 'close') {
        session.qr = null;
        session.connectionState = 'close';
        const reasonMsg = lastDisconnect?.error?.message || lastDisconnect?.error || 'unknown';
        logger.error(`Connection Lost (${session.id}) — ${String(reasonMsg)}`);
        publishSessions();

        const reconnect = session.autoReconnect && shouldReconnect(lastDisconnect, DisconnectReason);
        if (reconnect) {
          logger.info(`Reconnecting session "${session.id}"...`);
          scheduleSessionReconnect(session, async () => {
            await startSession(session.id);
          });
        } else {
          logger.warn(`Session "${session.id}" logged out / reconnect disabled. Use dashboard reconnect or signout.`);
        }
      }
    } catch (err) {
      logger.error(`connection.update handler error (${session.id})`, err?.message || err);
    }
  });

  sock.ev.on('messages.upsert', async (event) => {
    try {
      const messages = event?.messages;
      if (!Array.isArray(messages)) return;

      for (const msg of messages) {
        await handleIncomingMessage(sock, msg, config);
      }
    } catch (err) {
      logger.error(`messages.upsert handler error (${session.id})`, err?.message || err);
    }
  });

  return { sock, DisconnectReason };
}

async function startSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  if (session.isStarting) return true;
  session.isStarting = true;
  session.autoReconnect = true;
  session.connectionState = 'connecting';
  publishSessions();

  try {
    try {
      const out = await createSocket(session);
      session.sock = out.sock;
      session.connectionState = 'connecting';
      publishSessions();
      return true;
    } catch (err) {
      logger.error(`Failed to create socket (${session.id})`, err?.message || err);
      scheduleSessionReconnect(session, async () => {
        await startSession(session.id);
      });
      return false;
    }
  } finally {
    session.isStarting = false;
  }
}

async function disconnectSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.autoReconnect = false;
  clearSessionReconnectTimer(session);
  if (session.sock?.ws?.close) {
    try {
      session.sock.ws.close();
    } catch {
      /* ignore */
    }
  }
  session.sock = null;
  session.qr = null;
  session.connectionState = 'disconnected';
  publishSessions();
  return true;
}

function removeDirectorySafe(targetDir) {
  try {
    fs.rmSync(targetDir, { recursive: true, force: true });
  } catch (e) {
    logger.error(`Failed to remove auth dir: ${targetDir}`, e?.message || e);
  }
}

async function signoutSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  session.autoReconnect = false;
  clearSessionReconnectTimer(session);

  if (session.sock?.logout) {
    try {
      await session.sock.logout();
    } catch {
      /* ignore */
    }
  }

  if (session.sock?.ws?.close) {
    try {
      session.sock.ws.close();
    } catch {
      /* ignore */
    }
  }

  session.sock = null;
  session.qr = null;
  session.connectionState = 'signed-out';
  removeDirectorySafe(session.authDir);
  fs.mkdirSync(session.authDir, { recursive: true });
  publishSessions();
  return true;
}

async function reconnectSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return false;
  await disconnectSession(sessionId);
  session.autoReconnect = true;
  await startSession(sessionId);
  return true;
}

function createNextSessionId() {
  let i = 2;
  while (sessions.has(`device-${i}`)) i += 1;
  return `device-${i}`;
}

async function createAndStartSession(maybeId) {
  const requested = sanitizeSessionId(maybeId);
  const id = requested || createNextSessionId();
  const session = createSession(id);
  await startSession(session.id);
  publishSessions();
  return {
    id: session.id,
    authDir: session.authDir,
    connection: session.connectionState,
    qr: session.qr,
  };
}

function installProcessGuards() {
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled Rejection', reason);
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught Exception', err?.message || err);
  });
}

async function main() {
  installProcessGuards();
  ensureAuthDirs();

  dashboard = startDashboard({
    getSessions: () => listSessionViews(),
    onCreateSession: async (id) => createAndStartSession(id),
    onDisconnectSession: async (id) => disconnectSession(id),
    onSignoutSession: async (id) => signoutSession(id),
    onReconnectSession: async (id) => reconnectSession(id),
  });
  const { port } = dashboard.getAddress();

  logger.printBanner('WhatsApp Bot — Baileys', [
    `Auth root: ${config.authRoot}`,
    `Command prefix: ${config.commandPrefix ? `"${config.commandPrefix}"` : '(none — plain commands)'}`,
    `Dashboard: http://localhost:${port}`,
    'Use dashboard for add/reconnect/disconnect/signout sessions',
    'Press Ctrl+C to stop',
  ]);

  await createAndStartSession('device-1');
}

main().catch((err) => {
  logger.error('Fatal startup error', err?.message || err);
  process.exitCode = 1;
});
