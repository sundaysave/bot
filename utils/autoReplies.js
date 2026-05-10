'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'auto-replies.json');

const MATCH_MODES = new Set(['exact', 'contains', 'startsWith']);

function ensureStorage() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(FILE)) {
    fs.writeFileSync(FILE, JSON.stringify([], null, 2), 'utf8');
  }
}

function load() {
  ensureStorage();
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function save(list) {
  ensureStorage();
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2), 'utf8');
}

function listReplies() {
  return load();
}

function normalizeMatchMode(mode) {
  const m = String(mode || 'exact').toLowerCase();
  return MATCH_MODES.has(m) ? m : 'exact';
}

function addReply({ trigger, reply, matchMode }) {
  const t = String(trigger || '').trim();
  const r = String(reply || '').trim();
  if (!t || !r) {
    throw new Error('trigger and reply are required');
  }
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const row = {
    id,
    trigger: t,
    reply: r,
    matchMode: normalizeMatchMode(matchMode),
  };
  const list = load();
  list.push(row);
  save(list);
  return row;
}

function removeReply(id) {
  const list = load();
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  save(next);
  return true;
}

/**
 * First matching rule wins. Matching is case-insensitive on the incoming message.
 * @param {string} text
 * @returns {string|null}
 */
function findAutoReply(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const list = load();

  for (const rule of list) {
    const trigger = String(rule.trigger || '').trim().toLowerCase();
    if (!trigger) continue;

    const mode = normalizeMatchMode(rule.matchMode);
    let hit = false;
    if (mode === 'contains') {
      hit = lower.includes(trigger);
    } else if (mode === 'startsWith') {
      hit = lower.startsWith(trigger);
    } else {
      hit = lower === trigger;
    }

    if (hit) return String(rule.reply);
  }

  return null;
}

module.exports = {
  listReplies,
  addReply,
  removeReply,
  findAutoReply,
  normalizeMatchMode,
};
