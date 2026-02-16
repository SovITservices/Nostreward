# Nostreward

Accepts valid redeem codes and rewards users with automatic zaps, note reposts, and private relay whitelist access. Codes can be distributed through product sales, promotions, or any channel you choose. When a user redeems a valid code, the bot triggers the configured reward — zapping their content, reposting their notes, adding their pubkey to a relay whitelist, or any combination of the three.

---

## Requirements

- Node.js 20 or later
- A Nostr private key (nsec or hex) for the bot account
- A Lightning wallet that supports Nostr Wallet Connect (NWC) — only needed if zapping is enabled

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
ENABLE_ZAP=true
ENABLE_REPOST=true
ENABLE_WHITELIST=true
```

See the [Configuration](#configuration) section below for all available options.

### 4. Add redeem codes

```bash
node manage-codes.js add <code>
```

Codes are stored as SHA-256 hashes in `codes.json` — the plaintext is never saved to disk. You can add new codes at any time without restarting the bot.

## Usage

Start the daemon:

```bash
npm start
```

The bot will:

1. Connect to the configured Nostr relays
2. Subscribe to notes containing the required hashtag (default: `#nostreward`)
3. When a note contains a valid unused redeem code, the bot will:
   - Zap the note via NWC (if enabled)
   - Repost the note (if enabled)
   - Add the author's pubkey to the relay whitelist (if enabled)
4. Send a DM to the user if a zap fails, and automatically retry after 30 minutes

### Managing codes

```bash
# Add a new code
node manage-codes.js add <code>

# List all codes and their status
node manage-codes.js list
```

## Configuration

All configuration is done through environment variables in the `.env` file.

| Variable | Required | Default | Description |
|---|---|---|---|
| `BOT_NSEC` | Yes | -- | The bot's Nostr private key in nsec or hex format |
| `NWC_URL` | If zapping | -- | Nostr Wallet Connect URL from your Lightning wallet |
| `RELAYS` | No | `wss://relay.primal.net, wss://relay.damus.io` | Comma-separated list of Nostr relay URLs |
| `ZAP_AMOUNT_SATS` | No | `21` | Default zap amount in satoshis |
| `ENABLE_ZAP` | No | `false` | Enable Lightning zaps for redeemed codes |
| `ENABLE_REPOST` | No | `false` | Enable note reposts for redeemed codes |
| `ENABLE_WHITELIST` | No | `false` | Enable adding pubkeys to a relay whitelist |
| `REQUIRED_HASHTAG` | No | `nostreward` | Hashtag the bot monitors (without `#`) |
| `CODES_FILE` | No | `codes.json` | Path to the redeem codes data file |
| `WHITELIST_FILE` | No | `whitelist.json` | Path to the whitelist data file |

### NWC URL format

The `NWC_URL` follows the standard Nostr Wallet Connect format:

```
nostr+walletconnect://<wallet_pubkey>?relay=<relay_url>&secret=<secret_hex>
```

## NWC Wallet Setup

A Nostr Wallet Connect (NWC) connection string is required when zapping is enabled. Below are instructions for two popular options.

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
    index.js      - Daemon entry point, note handling, zap retry logic
    bot.js        - NDK setup, zapping, reposting, DMs, NWC payment logic
    codes.js      - Redeem code hashing, matching, and persistence
    config.js     - Environment variable loading and validation
    whitelist.js  - Relay whitelist management
  manage-codes.js - CLI tool for adding and listing redeem codes
  .env.example    - Example environment configuration
```

## License

GPL-3.0
