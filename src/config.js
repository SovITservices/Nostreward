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

  // Action toggles
  enableZap: process.env.ENABLE_ZAP === "true",
  enableRepost: process.env.ENABLE_REPOST === "true",
  enableWhitelist: process.env.ENABLE_WHITELIST === "true",

  // File paths
  codesFile: process.env.CODES_FILE || "codes.json",
  whitelistFile: process.env.WHITELIST_FILE || "whitelist.json",

  // Required hashtag for note filtering (without #)
  requiredHashtag: process.env.REQUIRED_HASHTAG || "nostreward",
};

export function validateConfig() {
  if (!config.botPrivateKey) {
    throw new Error("BOT_NSEC is required. Set it in your .env file.");
  }
  if (config.enableZap && !config.nwcUrl) {
    throw new Error("NWC_URL is required when ENABLE_ZAP=true. Set it in your .env file.");
  }
}
