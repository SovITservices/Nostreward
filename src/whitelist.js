import { readFileSync, writeFileSync, existsSync } from "fs";

/**
 * Load the whitelist from disk.
 * @param {string} filePath
 * @returns {{ pubkeys: Array }}
 */
export function loadWhitelist(filePath) {
  if (!existsSync(filePath)) {
    return { pubkeys: [] };
  }
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/**
 * Save the whitelist to disk.
 * @param {string} filePath
 * @param {{ pubkeys: Array }} data
 */
export function saveWhitelist(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Add a pubkey to the whitelist (idempotent - skips if already present).
 * @param {string} filePath
 * @param {string} pubkey - Hex pubkey
 * @param {string} eventId - Event that triggered the addition
 * @returns {boolean} true if added, false if already present
 */
export function addToWhitelist(filePath, pubkey, eventId) {
  const data = loadWhitelist(filePath);

  if (data.pubkeys.some((entry) => entry.pubkey === pubkey)) {
    return false;
  }

  data.pubkeys.push({
    pubkey,
    addedAt: new Date().toISOString(),
    reason: `Redeemed code on event ${eventId}`,
  });

  saveWhitelist(filePath, data);
  return true;
}
