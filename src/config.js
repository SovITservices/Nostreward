import "dotenv/config";

const DEFAULT_RELAYS = [
  "wss://relay.primal.net",
  "wss://relay.damus.io",
];

export const config = {
  // Bot's Nostr private key (hex or nsec format)
  botPrivateKey: process.env.BOT_NSEC || "",

  // Nostr Wallet Connect URL from your Lightning wallet
  // Format: nostr+walletconnect://pubkey?relay=wss://...&secret=hex
  nwcUrl: process.env.NWC_URL || "",

  // Relays to connect to (comma-separated in env, or defaults)
  relays: process.env.RELAYS
    ? process.env.RELAYS.split(",").map((r) => r.trim())
    : DEFAULT_RELAYS,

  // Default zap amount in sats
  zapAmountSats: parseInt(process.env.ZAP_AMOUNT_SATS || "21", 10),
};

export function validateConfig() {
  if (!config.botPrivateKey) {
    throw new Error("BOT_NSEC is required. Set it in your .env file.");
  }
  if (!config.nwcUrl) {
    throw new Error("NWC_URL is required. Set it in your .env file.");
  }
}
