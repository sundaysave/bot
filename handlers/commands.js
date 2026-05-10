'use strict';

const logger = require('../utils/logger');
const { findAutoReply } = require('../utils/autoReplies');

/**
 * Central command registry: add new entries here to extend the bot.
 * Each handler receives { sock, msg, text, args } and returns a string reply.
 */
const commandRegistry = {
  hi: {
    description: 'Friendly greeting',
    run: async () => 'Hello from Baileys Bot 👋',
  },
  ping: {
    description: 'Check if the bot is alive',
    run: async () => 'pong',
  },
  menu: {
    description: 'List all commands',
    run: async () =>
      [
        'Available Commands:',
        '- hi',
        '- ping',
        '- time',
        '- help',
        '- menu',
      ].join('\n'),
  },
  time: {
    description: 'Show current server time',
    run: async () => {
      const now = new Date();
      const formatted = now.toLocaleString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
      return `Current server time is ${formatted}`;
    },
  },
  help: {
    description: 'How to use this bot',
    run: async ({ config }) => {
      const prefixNote = config.commandPrefix
        ? `Commands use the prefix "${config.commandPrefix}" (example: ${config.commandPrefix}ping).`
        : 'Send a command as a plain message (example: ping).';
      return [
        'Baileys WhatsApp Bot — Help',
        '',
        prefixNote,
        '',
        'Try: hi, ping, time, menu',
        '',
        'Session data is stored in the auth/ folder on this machine.',
      ].join('\n');
    },
  },
};

/**
 * Pull user-visible text from a Baileys WAMessage (text + common media captions).
 */
function extractText(message) {
  try {
    const inner = message?.message;
    if (!inner) return '';

    if (inner.conversation) return inner.conversation;
    if (inner.extendedTextMessage?.text) return inner.extendedTextMessage.text;

    const captionTypes = [
      'imageMessage',
      'videoMessage',
      'documentMessage',
    ];
    for (const t of captionTypes) {
      if (inner[t]?.caption) return inner[t].caption;
    }

    return '';
  } catch {
    return '';
  }
}

/**
 * Format JID for logs (phone-style chats only; LIDs stay as-is).
 */
function formatSender(jid) {
  if (!jid) return 'unknown';
  if (jid.endsWith('@s.whatsapp.net')) {
    return jid.replace('@s.whatsapp.net', '');
  }
  return jid;
}

function parseCommandLine(rawText, commandPrefix) {
  const trimmed = (rawText || '').trim();
  if (!trimmed) return null;

  if (commandPrefix) {
    if (!trimmed.startsWith(commandPrefix)) return null;
    const rest = trimmed.slice(commandPrefix.length).trim();
    if (!rest) return null;
    const parts = rest.split(/\s+/);
    const name = (parts[0] || '').toLowerCase();
    const args = parts.slice(1);
    return { name, args, raw: rest };
  }

  const parts = trimmed.split(/\s+/);
  const name = (parts[0] || '').toLowerCase();
  const args = parts.slice(1);
  return { name, args, raw: trimmed };
}

/**
 * Handle one incoming message: log, then run commands when applicable.
 */
async function handleIncomingMessage(sock, message, config) {
  try {
    if (!message || typeof message !== 'object') return;
    if (!message.key) return;

    // Ignore our own messages to avoid loops.
    if (message.key.fromMe) return;

    const remoteJid = message.key.remoteJid;
    if (!remoteJid) return;

    // Status / broadcast updates — not chat messages we should answer.
    if (remoteJid === 'status@broadcast') {
      logger.debug('Skipping status broadcast message');
      return;
    }

    // In groups, `participant` is the sender; in DMs, `remoteJid` is the contact.
    const senderJid = message.key.participant || remoteJid;

    const text = extractText(message);
    const tsSeconds = message.messageTimestamp;
    const ts =
      tsSeconds != null
        ? new Date(Number(tsSeconds) * 1000)
        : new Date();

    logger.info(`New Message from ${formatSender(senderJid)}`);
    // eslint-disable-next-line no-console
    console.log(`       Message: ${text ? text : '(empty / non-text)'}`);
    // eslint-disable-next-line no-console
    console.log(`       Timestamp: ${ts.toISOString()}`);

    if (!text || !String(text).trim()) return;

    const autoText = findAutoReply(text);
    if (autoText != null) {
      logger.info('Auto-reply sent');
      await sock.sendMessage(remoteJid, { text: String(autoText) });
      return;
    }

    const parsed = parseCommandLine(text, config.commandPrefix);
    if (!parsed) return;

    const def = commandRegistry[parsed.name];
    if (!def) return;

    logger.info(`Command Executed: ${parsed.name}`);

    const replyText = await def.run({
      sock,
      msg: message,
      text: parsed.raw,
      args: parsed.args,
      config,
    });

    if (replyText == null) return;

    await sock.sendMessage(remoteJid, { text: String(replyText) });
  } catch (err) {
    logger.error('handleIncomingMessage failed', err?.message || err);
  }
}

function listRegisteredCommands() {
  return { ...commandRegistry };
}

module.exports = {
  handleIncomingMessage,
  extractText,
  formatSender,
  listRegisteredCommands,
  /** Exported for tests / extensions */
  commandRegistry,
};
