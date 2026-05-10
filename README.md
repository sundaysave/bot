# WhatsApp Bot (Node.js + Baileys)

Small, production-minded WhatsApp user-bot that logs in with a **QR code**, saves the session under `auth/`, and replies to simple **text commands**. It uses [**Baileys**](https://github.com/WhiskeySockets/Baileys) (`@whiskeysockets/baileys`) — a WebSocket client that speaks the same protocol as WhatsApp Web (no browser automation).

> **Disclaimer:** This is an unofficial project. Use it responsibly and in line with WhatsApp’s Terms of Service. Do not spam or automate harassment.

## Features

- Targets **Baileys 7** (currently published on npm as `7.0.0-rc.x`). The library is **ESM-only**; this project stays **CommonJS** and loads Baileys via **dynamic `import()`** in `index.js` (supported on Node 18+).
- QR login with **terminal QR** (`qrcode-terminal`)
- **Session persistence** via `useMultiFileAuthState` → files in `auth/`
- **Automatic reconnect** on transient disconnects (not when logged out)
- **Command system** with centralized registration in `handlers/commands.js`
- **Structured logging** (`[INFO]`, `[ERROR]`, …) in `utils/logger.js`
- **Optional command prefix** via `COMMAND_PREFIX` (see below)

## Requirements

- **Node.js 18+** (recommended: current LTS)
- A WhatsApp account on your phone to scan the QR code

## Installation

```bash
cd whatsapp-bot
npm install
```

## Run

```bash
npm start
```

(`npm run dev` is the same command.)

### First-time login (QR)

1. Run `npm start`.
2. When a QR appears in the terminal, open **WhatsApp** on your phone.
3. Go to **Settings → Linked devices → Link a device**.
4. Scan the QR code.
5. After a successful link you should see: `[INFO] WhatsApp Connected`.

The next time you start the bot, it should connect **without** a new QR as long as the `auth/` folder is intact.

## Example commands

Send these in a chat **to the number that is logged in as the bot** (from another phone or a friend):

| You send | Bot replies |
|----------|-------------|
| `hi` | `Hello from Baileys Bot 👋` |
| `ping` | `pong` |
| `time` | `Current server time is 10:30 PM` (example; follows server locale) |
| `menu` | Lists `hi`, `ping`, `time`, `help`, `menu` |
| `help` | Short help text |

### Optional command prefix

By default, commands are plain words (`ping`). To require a prefix (e.g. only answer `!ping`):

**Windows (PowerShell)**

```powershell
$env:COMMAND_PREFIX="!"
npm start
```

**macOS / Linux**

```bash
COMMAND_PREFIX='!' npm start
```

## Project layout

```text
whatsapp-bot/
├── package.json       # Dependencies & scripts
├── index.js           # Connection, QR, reconnect, message events
├── README.md
├── auth/              # Created at runtime — session keys (keep secret)
├── utils/
│   └── logger.js      # Timestamped [INFO]/[ERROR] logs + banner
└── handlers/
    └── commands.js    # Command registry + message parsing
```

- **`index.js`** — Loads Baileys, wires `connection.update`, `messages.upsert`, saves creds, schedules reconnects.
- **`handlers/commands.js`** — Single place to add commands (`commandRegistry`).
- **`utils/logger.js`** — Human-friendly logs; flip on `DEBUG=1` for extra lines.
- **`auth/`** — Multi-file auth state; **do not commit** this folder to git in real projects.

## How Baileys works (short)

1. Your Node process opens a **WebSocket** to WhatsApp’s servers, similar to WhatsApp Web.
2. The first link uses a **QR** (or pairing code) so WhatsApp trusts this “device.”
3. Baileys stores **cryptographic session material** (Signal-style) in the auth state. You **must** persist updates (`creds.update` → `saveCreds`) or messaging breaks.
4. Incoming data arrives as **events** (`messages.upsert`, etc.). You decrypt/handle messages and call APIs like `sendMessage`.

Official docs: [https://baileys.wiki](https://baileys.wiki)

## Extending commands

Open `handlers/commands.js` and add an entry to `commandRegistry`:

```js
const commandRegistry = {
  // ...
  hello: {
    description: 'Custom greeting',
    run: async ({ args }) => `You said: ${args.join(' ')}`,
  },
};
```

Restart the bot. If you use a prefix, remember to send `!hello` (or your chosen prefix).

## Troubleshooting

| Issue | What to try |
|-------|----------------|
| **QR never appears** | Ensure the terminal supports UTF-8 / large output; try a bigger window. Check you are on Node 18+. |
| **Stuck reconnecting** | Stop the bot, delete the `auth/` folder, run again, and scan a **new** QR. |
| **`loggedOut` / forced logout** | WhatsApp may revoke linked devices. Re-link via QR. |
| **No reply to commands** | Confirm you are messaging the **bot account’s** number, command spelling matches, and if `COMMAND_PREFIX` is set, your message starts with that prefix. |
| **ESM / import errors** | This repo uses **CommonJS** (`require`) for your code; Baileys 7+ is loaded via **dynamic `import()`** inside `index.js` — keep Node updated. |

## Session & security notes

- Treat `auth/` like a **password**: anyone with those files can impersonate your WhatsApp session.
- Prefer environment-specific folders for scaling, e.g. `AUTH_DIR=/var/lib/wa-bot/auth`.
- For multi-tenant or hosted setups, replace `useMultiFileAuthState` with a database-backed auth adapter (Baileys documents the shape of the auth state).

## Scripts reference

```json
"scripts": {
  "start": "node index.js",
  "dev": "node index.js"
}
```

## License

MIT
