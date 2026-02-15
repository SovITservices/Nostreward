/**
 * Test script for the zap function.
 *
 * Usage:
 *   node test-zap.js <note_id> [amount_sats]
 *
 * Examples:
 *   node test-zap.js note1abc123...          # zap 21 sats (default)
 *   node test-zap.js note1abc123... 10       # zap 10 sats
 *   node test-zap.js <hex_event_id> 5        # zap 5 sats
 */

import { validateConfig } from "./src/config.js";
import { initBot, zapNote } from "./src/bot.js";

const noteId = process.argv[2];
const amountSats = parseInt(process.argv[3] || "21", 10);

if (!noteId) {
  console.error("Usage: node test-zap.js <note_id> [amount_sats]");
  console.error("");
  console.error("  note_id     - note1..., nevent1..., or hex event ID");
  console.error("  amount_sats - zap amount in sats (default: 21)");
  process.exit(1);
}

async function main() {
  try {
    console.log("=== ZAP FUNCTION TEST ===\n");

    // 1. Validate config
    console.log("[1/3] Validating config...");
    validateConfig();
    console.log("  BOT_NSEC: set");
    console.log("  NWC_URL: set");

    // 2. Initialize bot
    console.log("\n[2/3] Initializing bot (connecting to relays + NWC)...");
    await initBot();

    // 3. Zap the note
    console.log(`\n[3/3] Zapping note with ${amountSats} sats...`);
    const start = Date.now();
    const result = await zapNote(noteId, amountSats, "Test zap from Nostreward!");
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log(`\n=== RESULT ===`);
    console.log(`  Status: SUCCESS`);
    console.log(`  Preimage/result: ${result}`);
    console.log(`  Time: ${elapsed}s`);
  } catch (err) {
    console.error(`\n=== FAILED ===`);
    console.error(`  Error: ${err.message}`);
    process.exit(1);
  }

  // Give relays time to propagate, then exit
  setTimeout(() => process.exit(0), 2000);
}

main();
