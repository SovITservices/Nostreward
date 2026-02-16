/**
 * Full integration test: publishes a profile (with lightning address) and a note
 * containing a redeem code + #nostreward hashtag to public relays.
 * The bot should pick it up and trigger zap, repost, and whitelist.
 */
const WebSocket = require("ws");
const {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} = require("nostr-tools/pure");
const { bytesToHex } = require("@noble/hashes/utils");

const RELAYS = ["wss://relay.primal.net", "wss://relay.damus.io"];
const CODE = "TESTCODE2026";
const LIGHTNING_ADDRESS = "smellydonna17@walletofsatoshi.com";

// Generate a test user
const userSk = generateSecretKey();
const userPk = getPublicKey(userSk);
console.log("Test user pubkey:", userPk);

function publishToRelay(relayUrl, events) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(relayUrl);
    const results = [];

    ws.on("open", () => {
      console.log(`Connected to ${relayUrl}`);
      for (const event of events) {
        ws.send(JSON.stringify(["EVENT", event]));
      }
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg[0] === "OK") {
        const accepted = msg[2];
        console.log(
          `  ${relayUrl}: event ${msg[1].slice(0, 8)}... ${accepted ? "accepted" : "rejected: " + msg[3]}`
        );
        results.push(msg);
        if (results.length === events.length) {
          ws.close();
          resolve(results);
        }
      }
    });

    ws.on("error", (e) => {
      console.error(`  ${relayUrl} error:`, e.message);
      reject(e);
    });

    setTimeout(() => {
      ws.close();
      resolve(results);
    }, 10000);
  });
}

async function main() {
  // 1. Create kind 0 profile with lightning address
  const profileEvent = finalizeEvent(
    {
      kind: 0,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify({
        name: "Test Redeemer",
        about: "Integration test user for nostreward",
        lud16: LIGHTNING_ADDRESS,
      }),
    },
    userSk
  );
  console.log("\nProfile event ID:", profileEvent.id);
  console.log("Lightning address:", LIGHTNING_ADDRESS);

  // 2. Create kind 1 note with the code and hashtag
  const noteEvent = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [["t", "nostreward"]],
      content: `Testing nostreward bot! Here is my code: ${CODE} #nostreward`,
    },
    userSk
  );
  console.log("Note event ID:", noteEvent.id);
  console.log("Note content:", noteEvent.content);

  // 3. Publish both events to public relays
  console.log("\nPublishing to relays...");
  for (const relay of RELAYS) {
    try {
      await publishToRelay(relay, [profileEvent, noteEvent]);
    } catch (e) {
      console.error(`Failed on ${relay}:`, e.message);
    }
  }

  console.log("\n=== Events published ===");
  console.log("The bot should now pick up the note and:");
  console.log("  1. Zap 21 sats to", LIGHTNING_ADDRESS);
  console.log("  2. Repost the note");
  console.log("  3. Add", userPk, "to whitelist.json");
  console.log("\nWatch the bot logs for activity.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
