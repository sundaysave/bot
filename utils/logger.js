'use strict';

/**
 * Small structured logger. Matches friendly tags like [INFO] / [ERROR].
 */

const LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
  DEBUG: 'DEBUG',
};

function write(level, message, extra) {
  const line = `[${level}] ${message}`;
  if (extra !== undefined) {
    // eslint-disable-next-line no-console
    console.log(line, extra);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(line);
}

function info(message, extra) {
  write(LEVELS.INFO, message, extra);
}

function warn(message, extra) {
  write(LEVELS.WARN, message, extra);
}

function error(message, extra) {
  write(LEVELS.ERROR, message, extra);
}

function debug(message, extra) {
  if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') {
    write(LEVELS.DEBUG, message, extra);
  }
}

/**
 * Pretty startup banner (no external deps).
 */
function printBanner(title, lines) {
  const width = 48;
  const border = '═'.repeat(width);
  // eslint-disable-next-line no-console
  console.log(`\n╔${border}╗`);
  // eslint-disable-next-line no-console
  console.log(`║ ${title.padEnd(width - 1)}║`);
  // eslint-disable-next-line no-console
  console.log(`╠${border}╣`);
  for (const row of lines) {
    // eslint-disable-next-line no-console
    console.log(`║ ${row.padEnd(width - 1)}║`);
  }
  // eslint-disable-next-line no-console
  console.log(`╚${border}╝\n`);
}

module.exports = {
  info,
  warn,
  error,
  debug,
  printBanner,
};
