const WebSocket = require("ws");
const {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
} = require("nostr-tools/pure");
const { bytesToHex } = require("@noble/hashes/utils");
const fs = require("fs");

const RELAY_URL = "ws://localhost:3334";

function connectAndAuth(sk) {
  return new Promise((resolve, reject) => {
    const pk = getPublicKey(sk);
    const ws = new WebSocket(RELAY_URL);
    let authed = false;

    ws.on("open", () => {});

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());

      if (msg[0] === "AUTH" && !authed) {
        authed = true;
        const challenge = msg[1];
        const authEvent = finalizeEvent(
          {
            kind: 22242,
            created_at: Math.floor(Date.now() / 1000),
            tags: [
              ["relay", RELAY_URL],
              ["challenge", challenge],
            ],
            content: "",
          },
          sk
        );
        ws.send(JSON.stringify(["AUTH", authEvent]));
        setTimeout(() => resolve({ ws, pk }), 500);
      }
    });

    ws.on("error", reject);
    setTimeout(() => reject(new Error("connect timeout")), 5000);
  });
}

function sendReq(ws, subId, filter) {
  return new Promise((resolve) => {
    const messages = [];
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      if (msg[0] === "EOSE" || msg[0] === "CLOSED") {
        ws.removeListener("message", handler);
        resolve(messages);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify(["REQ", subId, filter]));
    setTimeout(() => {
      ws.removeListener("message", handler);
      resolve(messages);
    }, 3000);
  });
}

function sendEvent(ws, event) {
  return new Promise((resolve) => {
    const handler = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg[0] === "OK") {
        ws.removeListener("message", handler);
        resolve(msg);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify(["EVENT", event]));
    setTimeout(() => {
      ws.removeListener("message", handler);
      resolve(null);
    }, 3000);
  });
}

async function main() {
  const testSk = generateSecretKey();
  const testPk = getPublicKey(testSk);
  console.log("Test pubkey:", testPk);

  // TEST 1: Unauthenticated REQ
  console.log("\n--- TEST 1: Unauthenticated REQ ---");
  const ws1 = new WebSocket(RELAY_URL);
  await new Promise((r) => ws1.on("open", r));
  const unauth = await sendReq(ws1, "test1", { kinds: [1], limit: 5 });
  const rejected1 = unauth.some(
    (m) => m[0] === "CLOSED" && m[2] && m[2].includes("auth-required")
  );
  console.log("Rejected (expected):", rejected1);
  ws1.close();

  // TEST 2: Authenticated but NOT whitelisted
  console.log("\n--- TEST 2: Authenticated, NOT whitelisted ---");
  const { ws: ws2, pk: pk2 } = await connectAndAuth(testSk);
  console.log("Authenticated as:", pk2);
  const notWl = await sendReq(ws2, "test2", { kinds: [1], limit: 5 });
  const rejected2 = notWl.some(
    (m) => m[0] === "CLOSED" && m[2] && m[2].includes("restricted")
  );
  console.log("Rejected (expected):", rejected2);
  ws2.close();

  // TEST 3: Add pubkey to whitelist, then connect and read
  console.log("\n--- TEST 3: Whitelisted user can read/write ---");
  const wlData = JSON.parse(fs.readFileSync("whitelist.json", "utf-8"));
  wlData.pubkeys.push({
    pubkey: testPk,
    addedAt: new Date().toISOString(),
    reason: "Test whitelisting",
  });
  fs.writeFileSync("whitelist.json", JSON.stringify(wlData, null, 2) + "\n");
  console.log("Added to whitelist.json");

  // Wait for relay to pick up file change
  await new Promise((r) => setTimeout(r, 2000));

  const { ws: ws3 } = await connectAndAuth(testSk);
  console.log("Authenticated as whitelisted user");

  // Write a test event
  const testEvent = finalizeEvent(
    {
      kind: 1,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: "Test post from whitelisted user",
    },
    testSk
  );
  const writeResult = await sendEvent(ws3, testEvent);
  const writeOk = writeResult && writeResult[0] === "OK" && writeResult[2] === true;
  console.log("Write allowed (expected):", writeOk);

  // Read it back
  const readResult = await sendReq(ws3, "test3", {
    kinds: [1],
    authors: [testPk],
    limit: 5,
  });
  const gotEvent = readResult.some(
    (m) => m[0] === "EVENT" && m[2] && m[2].content === "Test post from whitelisted user"
  );
  console.log("Read allowed (expected):", gotEvent);
  ws3.close();

  // Summary
  console.log("\n=== RESULTS ===");
  console.log("Test 1 - Unauthenticated blocked:", rejected1 ? "PASS" : "FAIL");
  console.log("Test 2 - Non-whitelisted blocked:", rejected2 ? "PASS" : "FAIL");
  console.log("Test 3 - Whitelisted can write: ", writeOk ? "PASS" : "FAIL");
  console.log("Test 3 - Whitelisted can read:  ", gotEvent ? "PASS" : "FAIL");

  const allPass = rejected1 && rejected2 && writeOk && gotEvent;
  console.log("\nAll tests:", allPass ? "PASSED" : "SOME FAILED");
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
