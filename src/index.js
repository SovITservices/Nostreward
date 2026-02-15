import { validateConfig, config } from "./config.js";
import { initBot, zapNote, repostNote, startMonitoring, getBotPubkey } from "./bot.js";
import { loadCodes, findCodeMatch, markCodeUsed, markZapFailed, clearZapFailed, getZapRetries } from "./codes.js";
import { addToWhitelist } from "./whitelist.js";

let subscription = null;
let retryInterval = null;
let codesData = null;

async function main() {
  console.log("=== Nostreward Daemon ===\n");

  // 1. Validate config
  validateConfig();

  const actions = [];
  if (config.enableZap) actions.push(`Zap (${config.zapAmountSats} sats)`);
  if (config.enableRepost) actions.push("Repost");
  if (config.enableWhitelist) actions.push("Whitelist");

  if (actions.length === 0) {
    console.error("No actions enabled. Set at least one of ENABLE_ZAP, ENABLE_REPOST, ENABLE_WHITELIST to true.");
    process.exit(1);
  }

  console.log(`Enabled actions: ${actions.join(", ")}`);
  console.log(`Required hashtag: #${config.requiredHashtag}`);

  // 2. Load codes
  codesData = loadCodes(config.codesFile);
  const unusedCount = codesData.codes.filter((c) => !c.used).length;
  console.log(`Loaded ${codesData.codes.length} codes (${unusedCount} unused)`);

  if (unusedCount === 0) {
    console.warn("Warning: No unused codes. Add codes with: node manage-codes.js add <code>");
  }

  // 3. Initialize bot
  await initBot();

  // 4. Start monitoring
  subscription = startMonitoring(config.requiredHashtag, handleNote);

  // 5. Start zap retry loop (checks every 60s)
  if (config.enableZap) {
    retryInterval = setInterval(processZapRetries, 60_000);
  }

  console.log("\nDaemon running. Waiting for notes containing redeem codes...");
  console.log("Press Ctrl+C to stop.\n");
}

/**
 * Process a single incoming note event.
 */
async function handleNote(event) {
  // Skip bot's own events
  if (event.pubkey === getBotPubkey()) return;

  // Check for code match
  const match = findCodeMatch(event.content, codesData);
  if (!match) return;

  console.log(`\n[CODE MATCH] Event ${event.id.slice(0, 12)}... by ${event.pubkey.slice(0, 12)}...`);
  console.log(`  Content: "${event.content.slice(0, 100)}${event.content.length > 100 ? "..." : ""}"`);

  // Mark code as used immediately (prevents double-redemption)
  markCodeUsed(config.codesFile, codesData, match.index, event.pubkey, event.id);
  console.log(`  Code consumed (hash: ${match.hash.slice(0, 16)}...)`);

  // Execute enabled actions
  if (config.enableZap) {
    try {
      await zapNote(event.id);
    } catch (err) {
      console.error(`  Zap failed: ${err.message}`);
      markZapFailed(config.codesFile, codesData, match.index);
      console.log(`  Zap retry scheduled in 30 minutes`);
    }
  }

  if (config.enableRepost) {
    try {
      await repostNote(event.id);
    } catch (err) {
      console.error(`  Repost failed: ${err.message}`);
    }
  }

  if (config.enableWhitelist) {
    try {
      const added = addToWhitelist(config.whitelistFile, event.pubkey, event.id);
      if (added) {
        console.log(`  Added ${event.pubkey.slice(0, 12)}... to whitelist`);
      } else {
        console.log(`  ${event.pubkey.slice(0, 12)}... already in whitelist`);
      }
    } catch (err) {
      console.error(`  Whitelist failed: ${err.message}`);
    }
  }
}

/**
 * Check for and process pending zap retries.
 */
async function processZapRetries() {
  const retries = getZapRetries(codesData);
  if (retries.length === 0) return;

  console.log(`\n[ZAP RETRY] ${retries.length} pending retry(s)...`);

  for (const retry of retries) {
    try {
      console.log(`  Retrying zap for event ${retry.usedOnEvent.slice(0, 12)}...`);
      await zapNote(retry.usedOnEvent);
      clearZapFailed(config.codesFile, codesData, retry.index);
      console.log(`  Zap retry succeeded!`);
    } catch (err) {
      console.error(`  Zap retry failed: ${err.message}`);
      markZapFailed(config.codesFile, codesData, retry.index);
      console.log(`  Next retry in 30 minutes`);
    }
  }
}

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down...`);
  if (subscription) {
    subscription.stop();
  }
  if (retryInterval) {
    clearInterval(retryInterval);
  }
  setTimeout(() => {
    console.log("Goodbye.");
    process.exit(0);
  }, 1000);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
