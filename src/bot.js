import WebSocket from "ws";
global.WebSocket = WebSocket;

import NDK, {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKZapper,
} from "@nostr-dev-kit/ndk";
import { getPublicKey, finalizeEvent } from "nostr-tools/pure";
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from "nostr-tools/nip04";
import { config } from "./config.js";

let ndk = null;
let botPubkey = null;
let nwcSigner = null;
let nwcSecretBytes = null;
let nwcClientPubkey = null;
let nwcWalletPubkey = null;
let nwcRelayUrl = null;

/**
 * Initialize NDK, connect to relays, and set up the NWC wallet.
 */
export async function initBot() {
  const signer = new NDKPrivateKeySigner(config.botPrivateKey);

  ndk = new NDK({
    explicitRelayUrls: config.relays,
    signer,
  });

  ndk.connect();
  // Allow time for relay connections to establish
  await new Promise((r) => setTimeout(r, 3000));
  const user = await signer.user();
  botPubkey = user.pubkey;
  console.log(`Bot connected as ${user.npub}`);
  console.log(`Relays: ${config.relays.join(", ")}`);

  // Parse NWC connection string (only needed when zapping)
  if (config.nwcUrl) {
    parseNwcUrl(config.nwcUrl);
    console.log(`NWC wallet connected (pubkey: ${nwcWalletPubkey.slice(0, 8)}...)`);
    console.log(`Default zap amount: ${config.zapAmountSats} sats`);
  }

  return ndk;
}

/**
 * Parse a nostr+walletconnect:// URL into its components.
 */
function parseNwcUrl(url) {
  // Format: nostr+walletconnect://walletPubkey?relay=wss://...&secret=hex
  const withoutScheme = url.replace("nostr+walletconnect://", "");
  const [pubkey, queryString] = withoutScheme.split("?");
  const params = new URLSearchParams(queryString);

  nwcWalletPubkey = pubkey;
  nwcRelayUrl = params.get("relay");
  const secret = params.get("secret");

  if (!nwcWalletPubkey || !nwcRelayUrl || !secret) {
    throw new Error(
      "Invalid NWC_URL. Expected format: nostr+walletconnect://pubkey?relay=wss://...&secret=hex"
    );
  }

  nwcSigner = new NDKPrivateKeySigner(secret);
  nwcSecretBytes = Uint8Array.from(Buffer.from(secret, "hex"));
  nwcClientPubkey = getPublicKey(nwcSecretBytes);
}

/**
 * Pay a Lightning invoice using NWC (NIP-47).
 * Uses raw WebSocket + nostr-tools for reliable relay communication.
 */
async function payInvoiceViaNwc(invoice) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(nwcRelayUrl);
    const timeout = setTimeout(() => {
      ws.close();
      console.log("  No confirmation from wallet (payment likely processed)");
      resolve("no-confirmation");
    }, 10000);

    ws.on("error", (e) => {
      clearTimeout(timeout);
      reject(new Error(`NWC WebSocket error: ${e.message}`));
    });

    ws.on("open", async () => {
      try {
        // Subscribe for responses before sending
        const subFilter = {
          kinds: [23195],
          authors: [nwcWalletPubkey],
          "#p": [nwcClientPubkey],
          since: Math.floor(Date.now() / 1000) - 10,
        };
        ws.send(JSON.stringify(["REQ", "nwc-pay", subFilter]));

        // Encrypt and build event
        const content = await nip04Encrypt(
          nwcSecretBytes,
          nwcWalletPubkey,
          JSON.stringify({ method: "pay_invoice", params: { invoice } })
        );

        const event = finalizeEvent(
          {
            kind: 23194,
            created_at: Math.floor(Date.now() / 1000),
            tags: [["p", nwcWalletPubkey]],
            content,
          },
          nwcSecretBytes
        );

        ws.send(JSON.stringify(["EVENT", event]));
        console.log("  NWC pay_invoice request sent, waiting for response...");
      } catch (e) {
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`NWC encrypt/send failed: ${e.message}`));
      }
    });

    ws.on("message", async (data) => {
      const msg = JSON.parse(data.toString());

      if (msg[0] === "OK" && !msg[2]) {
        // Relay rejected our event
        clearTimeout(timeout);
        ws.close();
        reject(new Error(`NWC relay rejected event: ${msg[3] || "unknown reason"}`));
        return;
      }

      if (msg[0] === "EVENT" && msg[2]?.kind === 23195) {
        try {
          const decrypted = await nip04Decrypt(
            nwcSecretBytes,
            nwcWalletPubkey,
            msg[2].content
          );
          const response = JSON.parse(decrypted);

          if (response.error) {
            clearTimeout(timeout);
            ws.close();
            reject(
              new Error(
                `NWC error: ${response.error.message || JSON.stringify(response.error)}`
              )
            );
          } else if (response.result) {
            clearTimeout(timeout);
            ws.close();
            const preimage = response.result.preimage || "paid";
            console.log(`  Payment confirmed (preimage: ${preimage.slice(0, 16)}...)`);
            resolve(preimage);
          }
        } catch (e) {
          // Can't decrypt - not for us, ignore
        }
      }
    });
  });
}

/**
 * Resolve a Lightning address (lud16) or LNURL (lud06) to a callback URL.
 */
async function resolveLnurl(lud16, lud06) {
  if (lud16) {
    const [name, domain] = lud16.split("@");
    const url = `https://${domain}/.well-known/lnurlp/${name}`;
    console.log(`  Resolving LNURL: ${lud16}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`LNURL resolve failed: ${res.status}`);
    return await res.json();
  }
  if (lud06) {
    // lud06 is a bech32-encoded URL - for now just support lud16
    throw new Error("lud06 not yet supported, author needs a Lightning address (lud16)");
  }
  throw new Error("Author has no Lightning address configured");
}

/**
 * Zap a Nostr note.
 * Manually handles the full NIP-57 zap flow:
 * 1. Fetch the note and author profile
 * 2. Resolve the author's Lightning address
 * 3. Create and sign a zap request (kind 9734)
 * 4. Request an invoice from the LNURL endpoint
 * 5. Pay the invoice via NWC
 *
 * @param {string} eventId - Event ID (hex, note1, or nevent)
 * @param {number} [amountSats] - Amount in sats (defaults to config.zapAmountSats)
 * @param {string} [comment] - Optional zap comment
 */
export async function zapNote(eventId, amountSats, comment) {
  const sats = amountSats || config.zapAmountSats;
  const amountMsat = sats * 1000;
  const zapComment = comment || "Zapped by Nostreward bot!";
  console.log(`\nZapping note ${eventId.slice(0, 12)}... with ${sats} sats`);

  // 1. Fetch the target event
  const event = await ndk.fetchEvent(eventId);
  if (!event) {
    throw new Error(`Event not found: ${eventId}`);
  }

  console.log(`  Found note by ${event.pubkey.slice(0, 12)}...`);
  console.log(`  Content: "${event.content.slice(0, 80)}${event.content.length > 80 ? "..." : ""}"`);

  // 2. Fetch author profile to get Lightning address
  const profileEvent = await ndk.fetchEvent({ kinds: [0], authors: [event.pubkey] });
  if (!profileEvent) {
    throw new Error("Could not fetch author profile");
  }
  const profile = JSON.parse(profileEvent.content);
  console.log(`  Lightning address: ${profile.lud16 || profile.lud06 || "NONE"}`);

  // 3. Resolve LNURL to get the callback endpoint
  const lnurlData = await resolveLnurl(profile.lud16, profile.lud06);
  if (!lnurlData.callback) {
    throw new Error("LNURL response missing callback URL");
  }
  if (lnurlData.allowsNostr !== undefined && !lnurlData.allowsNostr) {
    throw new Error("LNURL endpoint does not support Nostr zaps");
  }
  console.log(`  LNURL endpoint supports zaps: ${lnurlData.allowsNostr ? "yes" : "unknown"}`);

  // 4. Create a zap request event (kind 9734)
  const botUser = await ndk.signer.user();
  const zapRequest = new NDKEvent(ndk);
  zapRequest.kind = 9734;
  zapRequest.content = zapComment;
  zapRequest.tags = [
    ["p", event.pubkey],
    ["e", event.id],
    ["amount", String(amountMsat)],
    ["relays", ...config.relays],
  ];
  await zapRequest.sign();
  const zapRequestJson = JSON.stringify(zapRequest.rawEvent());
  console.log(`  Zap request created (kind 9734)`);

  // 5. Request invoice from LNURL callback
  const sep = lnurlData.callback.includes("?") ? "&" : "?";
  const invoiceUrl = `${lnurlData.callback}${sep}amount=${amountMsat}&nostr=${encodeURIComponent(zapRequestJson)}`;
  const invoiceRes = await fetch(invoiceUrl);
  if (!invoiceRes.ok) {
    throw new Error(`Invoice request failed: ${invoiceRes.status}`);
  }
  const invoiceData = await invoiceRes.json();
  if (!invoiceData.pr) {
    throw new Error(`No invoice returned: ${JSON.stringify(invoiceData)}`);
  }
  console.log(`  Invoice received: ${invoiceData.pr.slice(0, 40)}...`);

  // 6. Pay the invoice via NWC
  const preimage = await payInvoiceViaNwc(invoiceData.pr);
  console.log(`  Zap complete!`);
  return preimage;
}

/**
 * Repost (boost) a Nostr note.
 * Creates and publishes a kind 6 repost event.
 *
 * @param {string} eventId - Event ID (hex, note1, or nevent)
 */
export async function repostNote(eventId) {
  console.log(`\nReposting note ${eventId.slice(0, 12)}...`);

  const event = await ndk.fetchEvent(eventId);
  if (!event) {
    throw new Error(`Event not found: ${eventId}`);
  }

  console.log(`  Found note by ${event.pubkey.slice(0, 12)}...`);

  const repostEvent = await event.repost(true);
  console.log(`  Repost published! (id: ${repostEvent.id?.slice(0, 12)}...)`);
  return repostEvent;
}

/**
 * Get the bot's hex pubkey (available after initBot).
 * @returns {string}
 */
export function getBotPubkey() {
  return botPubkey;
}

/**
 * Start a real-time subscription to kind 1 events with a hashtag filter.
 *
 * @param {string} hashtag - Required hashtag (without #)
 * @param {function} onNoteReceived - Async callback for each matching event
 * @returns {object} The subscription object (call .stop() to clean up)
 */
export function startMonitoring(hashtag, onNoteReceived) {
  console.log(`\nSubscribing to kind:1 events with #${hashtag}...`);

  const filter = {
    kinds: [1],
    "#t": [hashtag],
    since: Math.floor(Date.now() / 1000),
  };

  const sub = ndk.subscribe(filter, { closeOnEose: false });

  sub.on("event", (event) => {
    onNoteReceived(event).catch((err) => {
      console.error(`Error processing event ${event.id?.slice(0, 12)}...: ${err.message}`);
    });
  });

  return sub;
}
