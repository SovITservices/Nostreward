import NDK, {
  NDKEvent,
  NDKPrivateKeySigner,
  NDKZapper,
} from "@nostr-dev-kit/ndk";
import { config } from "./config.js";

let ndk = null;
let nwcSigner = null;
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

  await ndk.connect();
  const user = await signer.user();
  console.log(`Bot connected as ${user.npub}`);
  console.log(`Relays: ${config.relays.join(", ")}`);

  // Parse NWC connection string
  parseNwcUrl(config.nwcUrl);
  console.log(`NWC wallet connected (pubkey: ${nwcWalletPubkey.slice(0, 8)}...)`);
  console.log(`Default zap amount: ${config.zapAmountSats} sats`);

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
}

/**
 * Pay a Lightning invoice using NWC (NIP-47).
 * Sends a kind 23194 encrypted request to the wallet and waits for a kind 23195 response.
 */
async function payInvoiceViaNwc(invoice) {
  // Connect to the NWC relay
  const nwcNdk = new NDK({
    explicitRelayUrls: [nwcRelayUrl],
    signer: nwcSigner,
  });
  await nwcNdk.connect();

  // Wait a moment for relay connection to stabilize
  await new Promise((r) => setTimeout(r, 1000));

  const nwcUser = await nwcSigner.user();

  // Create the NWC request (kind 23194)
  const reqEvent = new NDKEvent(nwcNdk);
  reqEvent.kind = 23194;
  reqEvent.tags = [["p", nwcWalletPubkey]];
  reqEvent.content = JSON.stringify({
    method: "pay_invoice",
    params: { invoice },
  });

  // NIP-04 encrypt to wallet
  await reqEvent.encrypt(
    nwcNdk.getUser({ pubkey: nwcWalletPubkey }),
    nwcSigner,
    "nip04"
  );

  // Subscribe for the response (kind 23195) before publishing
  const responsePromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("NWC payment timed out (30s)")), 30000);

    const sub = nwcNdk.subscribe(
      {
        kinds: [23195],
        authors: [nwcWalletPubkey],
        "#p": [nwcUser.pubkey],
        since: Math.floor(Date.now() / 1000) - 5,
      },
      { closeOnEose: false }
    );

    sub.on("event", async (event) => {
      try {
        await event.decrypt(
          nwcNdk.getUser({ pubkey: nwcWalletPubkey }),
          nwcSigner,
          "nip04"
        );
        const response = JSON.parse(event.content);

        if (response.error) {
          clearTimeout(timeout);
          sub.stop();
          reject(new Error(`NWC error: ${response.error.message || JSON.stringify(response.error)}`));
        } else if (response.result?.preimage) {
          clearTimeout(timeout);
          sub.stop();
          resolve(response.result.preimage);
        }
      } catch (e) {
        // Ignore events we can't decrypt (not for us)
      }
    });
  });

  // Publish the request
  await reqEvent.sign(nwcSigner);
  await reqEvent.publish();
  console.log("  NWC pay_invoice request sent, waiting for response...");

  const preimage = await responsePromise;
  console.log(`  Payment confirmed (preimage: ${preimage.slice(0, 16)}...)`);

  return preimage;
}

/**
 * Zap a Nostr note.
 * Fetches the event, creates a zap request (NIP-57), gets an invoice, and pays via NWC.
 *
 * @param {string} eventId - Event ID (hex, note1, or nevent)
 * @param {number} [amountSats] - Amount in sats (defaults to config.zapAmountSats)
 * @param {string} [comment] - Optional zap comment
 */
export async function zapNote(eventId, amountSats, comment) {
  const sats = amountSats || config.zapAmountSats;
  console.log(`\nZapping note ${eventId.slice(0, 12)}... with ${sats} sats`);

  const event = await ndk.fetchEvent(eventId);
  if (!event) {
    throw new Error(`Event not found: ${eventId}`);
  }

  console.log(`  Found note by ${event.pubkey.slice(0, 12)}...`);
  console.log(`  Content: "${event.content.slice(0, 80)}${event.content.length > 80 ? "..." : ""}"`);

  const zapper = new NDKZapper(event, sats * 1000, "msat", {
    ndk,
    comment: comment || "Zapped by Nostreward bot!",
    lnPay: async (payment) => {
      const preimage = await payInvoiceViaNwc(payment.pr);
      return { preimage };
    },
  });

  const results = await zapper.zap();
  console.log(`  Zap complete!`);
  return results;
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
