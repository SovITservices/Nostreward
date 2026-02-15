# Nostreward

A Nostr reward bot that zaps and reposts notes using Nostr Wallet Connect (NWC). Give it a note ID and it will send a Lightning zap and boost the note to your followers.

**Bot npub:** `npub1h0n8fptj0n8w8tpnc49spshe9jyxk3jmmlre62zesd5ungahl0usfnzr87`

<p align="center">
  <img src="docs/nostr-qr.png" alt="Nostreward bot Nostr profile QR code" width="200" />
</p>

---

## Requirements

- Node.js 20 or later
- A Nostr private key (nsec or hex) for the bot account
- A Lightning wallet that supports Nostr Wallet Connect (NWC)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/SovITservices/Nostreward.git
cd Nostreward
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env` with your values:

```
BOT_NSEC=nsec1your_private_key_here
NWC_URL=nostr+walletconnect://your_wallet_pubkey?relay=wss://relay.example.com&secret=your_secret_hex
```

See the [Configuration](#configuration) section below for all available options.

## Usage

Run the bot with a Nostr note ID. The bot accepts hex event IDs, `note1...` bech32 IDs, and `nevent1...` identifiers.

```bash
node src/index.js <note_id>
```

Or using npm:

```bash
npm start -- <note_id>
```

### Examples

Zap and repost using a `note1` identifier:

```bash
node src/index.js note1abc123def456...
```

Zap and repost using a hex event ID:

```bash
node src/index.js 3bf0c63fcb93463407af97a507f9f25bfa2be5d72f3e9a4c5a5e0e7f214fa7e8
```

Zap and repost using an `nevent1` identifier:

```bash
node src/index.js nevent1qqsxyz789...
```

The bot will:

1. Connect to the configured relays
2. Fetch the target note
3. Send a Lightning zap (default 21 sats) via NWC
4. Repost (boost) the note
5. Exit after events propagate

## Configuration

All configuration is done through environment variables in the `.env` file.

| Variable | Required | Default | Description |
|---|---|---|---|
| `BOT_NSEC` | Yes | -- | The bot's Nostr private key in nsec or hex format |
| `NWC_URL` | Yes | -- | Nostr Wallet Connect URL from your Lightning wallet |
| `RELAYS` | No | `wss://relay.primal.net, wss://relay.damus.io` | Comma-separated list of Nostr relay URLs |
| `ZAP_AMOUNT_SATS` | No | `21` | Default zap amount in satoshis |

### NWC URL format

The `NWC_URL` follows the standard Nostr Wallet Connect format:

```
nostr+walletconnect://<wallet_pubkey>?relay=<relay_url>&secret=<secret_hex>
```

## NWC Wallet Setup

The bot requires a Nostr Wallet Connect (NWC) connection string from a compatible Lightning wallet. Below are instructions for two popular options.

### Primal Wallet

1. Open the Primal app and go to your wallet
2. Tap the menu or settings icon in the wallet view
3. Select **Nostr Wallet Connect** or **NWC**
4. Create a new connection and give it a name (e.g., "Nostreward bot")
5. Optionally set a spending limit for the connection
6. Copy the connection string -- it starts with `nostr+walletconnect://`
7. Paste it as the `NWC_URL` value in your `.env` file

### Alby

1. Log in to your Alby account at [getalby.com](https://getalby.com)
2. Go to **Settings** then **Connections** (or visit the Alby NWC page directly)
3. Click **Add a new connection**
4. Name the connection (e.g., "Nostreward bot") and set a budget if desired
5. Copy the pairing URL -- it starts with `nostr+walletconnect://`
6. Paste it as the `NWC_URL` value in your `.env` file

### Other Wallets

Any Lightning wallet that supports NWC (NIP-47) should work. Look for a "Nostr Wallet Connect" option in your wallet's settings and generate a connection string.

## Project Structure

```
nostreward/
  src/
    index.js    - Entry point, CLI argument handling
    bot.js      - NDK setup, zapping, reposting, NWC payment logic
    config.js   - Environment variable loading and validation
  docs/
    nostr-qr.png - Bot profile QR code
  .env.example   - Example environment configuration
  package.json
```

## Dependencies

- [@nostr-dev-kit/ndk](https://github.com/nostr-dev-kit/ndk) -- Nostr Development Kit for event handling, signing, and zapping
- [dotenv](https://github.com/motdotla/dotenv) -- Environment variable loading from `.env` files

## License

ISC
