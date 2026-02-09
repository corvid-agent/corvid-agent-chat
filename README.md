# CorvidAgent Chat

Decentralized peer-to-peer messaging client built on [AlgoChat](https://github.com/CorvidLabs/ts-algochat) — encrypted communication over the Algorand blockchain.

## Features

- **End-to-end encrypted messaging** via AES-GCM with PSK (Pre-Shared Key) ratcheting
- **Algorand-native** — messages are sent as encrypted transaction notes
- **QR code pairing** — scan a QR code to establish a secure connection
- **Wallet management** — create or import Algorand wallets with password-encrypted local storage
- **Message persistence** — chat history stored in IndexedDB, survives page refresh
- **Offline-first** — works as a static site, no backend required
- **Markdown rendering** — supports code blocks, bold, italic, links, lists, and more

## Architecture

```
src/
  main.ts          # App entry point, view router
  types.ts         # Core TypeScript interfaces
  store.ts         # Reactive state management (pub/sub)
  messaging.ts     # AlgoChat messaging service (send/receive/poll)
  wallet.ts        # Wallet encryption (AES-GCM + PBKDF2)
  markdown.ts      # Lightweight markdown-to-HTML renderer
  qr-scanner.ts    # QR code scanning + PSK URI parsing
  toast.ts         # Toast notification system
  utils.ts         # Shared utilities (escapeHtml, base64, etc.)
  db.ts            # IndexedDB message persistence
  views/
    setup.ts       # Wallet creation/import/unlock
    scan.ts        # QR code scanning for agent pairing
    chat.ts        # Main chat interface
    settings.ts    # Wallet & connection management
```

**Stack:** TypeScript, Vite, vanilla DOM (no framework), Web Crypto API, Algorand SDK, AlgoChat protocol.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (or Node.js 18+)

### Install & Run

```bash
# Install dependencies
bun install

# Start dev server
bun run dev

# Run tests
bun run test

# Build for production
bun run build
```

### Usage

1. **Create or import a wallet** — set a password to encrypt your wallet locally
2. **Scan the agent's QR code** — or paste the PSK URI manually
3. **Start chatting** — messages are encrypted and sent as Algorand transactions

## Encryption

- **Wallet storage:** Mnemonic encrypted with AES-256-GCM, key derived via PBKDF2 (600k iterations, SHA-256)
- **Message encryption:** PSK-based ratcheting with per-message derived keys, NaCl box (X25519 + XSalsa20-Poly1305)
- **Transport:** Encrypted payloads sent as Algorand payment transaction notes

## Deployment

The app deploys as a static site to GitHub Pages via the `deploy.yml` workflow (triggers on push to `main`).

```bash
bun run build
# Output in dist/
```

## Testing

```bash
bun run test          # Run once
bun run test:watch    # Watch mode
```

Tests cover: utility functions, markdown rendering, and state management.

## License

MIT
