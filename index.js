'use strict';

/**
 * WhatsApp bot entry — Baileys 7+ ships as ESM, so we dynamic-import it from this CommonJS file.
 * Local modules stay on require() for a simple, beginner-friendly layout.
 */

const path = require('path');
const pino = require('pino');

const logger = require('./utils/logger');
const { handleIncomingMessage } = require('./handlers/commands');
const { startDashboard } = require('./server/dashboard');

const config = {
  /** Set COMMAND_PREFIX (e.g. !) so only "!ping" triggers commands; leave empty for plain "ping". */
  commandPrefix: process.env.COMMAND_PREFIX || '',
  authDir: process.env.AUTH_DIR
    ? path.resolve(process.env.AUTH_DIR)
    : path.join(__dirname, 'auth'),
};

let reconnectTimer = null;
let activeSocket = null;
let isStarting = false;
let dashboard = null;

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(fn, delayMs = 3500) {
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    fn();
  }, delayMs);
}

/**
 * Load Baileys + Boom (ESM) once per process.
 */
async function loadBaileys() {
  const baileys = await import('@whiskeysockets/baileys');

  return {
    makeWASocket: baileys.default,
    DisconnectReason: baileys.DisconnectReason,
    useMultiFileAuthState: baileys.useMultiFileAuthState,
    fetchLatestBaileysVersion: baileys.fetchLatestBaileysVersion,
    Browsers: baileys.Browsers,
  };
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

async function createSocket() {
  const {
    makeWASocket,
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    Browsers,
  } = await loadBaileys();

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

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
    browser: Browsers?.macOS('Baileys Bot') || ['Baileys Bot', 'Chrome', '1.0.0'],
    markOnlineOnConnect: true,
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    try {
      const { connection, lastDisconnect, qr } = update;

      if (qr && dashboard) {
        dashboard.setQr(qr);
        logger.info('Scan the QR code in the web dashboard (Linked Devices)');
      }

      if (connection && dashboard) {
        dashboard.setConnection(connection);
      }

      if (connection === 'open') {
        if (dashboard) dashboard.setQr(null);
        logger.info('WhatsApp Connected');
      }

      if (connection === 'close') {
        if (dashboard) dashboard.setQr(null);
        const reasonMsg = lastDisconnect?.error?.message || lastDisconnect?.error || 'unknown';
        logger.error(`Connection Lost — ${String(reasonMsg)}`);

        const reconnect = shouldReconnect(lastDisconnect, DisconnectReason);
        if (reconnect) {
          logger.info('Reconnecting…');
          scheduleReconnect(() => {
            start().catch((e) => logger.error('Reconnect start failed', e?.message || e));
          });
        } else {
          logger.warn('Logged out or not reconnecting. Delete auth/ and scan QR again if needed.');
        }
      }
    } catch (err) {
      logger.error('connection.update handler error', err?.message || err);
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
      logger.error('messages.upsert handler error', err?.message || err);
    }
  });

  return sock;
}

async function start() {
  if (isStarting) return;
  isStarting = true;
  try {
    try {
      activeSocket = await createSocket();
    } catch (err) {
      logger.error('Failed to create socket', err?.message || err);
      scheduleReconnect(() => {
        start().catch((e) => logger.error('Retry start failed', e?.message || e));
      });
    }
  } finally {
    isStarting = false;
  }
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

  dashboard = startDashboard();
  const { port } = dashboard.getAddress();

  logger.printBanner('WhatsApp Bot — Baileys', [
    `Auth folder: ${config.authDir}`,
    `Command prefix: ${config.commandPrefix ? `"${config.commandPrefix}"` : '(none — plain commands)'}`,
    `Dashboard: http://localhost:${port}`,
    'Press Ctrl+C to stop',
  ]);

  await start();
}

main().catch((err) => {
  logger.error('Fatal startup error', err?.message || err);
  process.exitCode = 1;
});
