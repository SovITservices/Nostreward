import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";

const ZAP_RETRY_DELAY_MS = 30 * 60 * 1000; // 30 minutes

/**
 * SHA-256 hash a plaintext code.
 * @param {string} plaintext
 * @returns {string} Hex-encoded hash
 */
export function hashCode(plaintext) {
  return createHash("sha256").update(plaintext.trim()).digest("hex");
}

/**
 * Load codes from JSON file. Returns empty structure if file doesn't exist.
 * @param {string} filePath
 * @returns {{ codes: Array }}
 */
export function loadCodes(filePath) {
  if (!existsSync(filePath)) {
    return { codes: [] };
  }
  return JSON.parse(readFileSync(filePath, "utf-8"));
}

/**
 * Save codes to JSON file.
 * @param {string} filePath
 * @param {{ codes: Array }} data
 */
export function saveCodes(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Add a new code (hashed). Rejects duplicates.
 * @param {string} filePath
 * @param {string} plaintext
 * @returns {string} The stored hash
 */
export function addCode(filePath, plaintext) {
  const data = loadCodes(filePath);
  const hash = hashCode(plaintext);

  if (data.codes.some((c) => c.hash === hash)) {
    throw new Error("Code already exists (duplicate hash)");
  }

  data.codes.push({
    hash,
    createdAt: new Date().toISOString(),
    used: false,
    usedBy: null,
    usedAt: null,
    usedOnEvent: null,
    zapFailed: false,
    zapRetryAt: null,
  });

  saveCodes(filePath, data);
  return hash;
}

/**
 * Check note content for any matching unused code.
 * Tokenizes by whitespace, strips punctuation from each token, hashes, and compares.
 *
 * @param {string} content
 * @param {{ codes: Array }} codesData
 * @returns {{ hash: string, index: number } | null}
 */
export function findCodeMatch(content, codesData) {
  const tokens = content.split(/\s+/).filter(Boolean);
  const unusedCodes = codesData.codes
    .map((c, i) => ({ ...c, index: i }))
    .filter((c) => !c.used);

  if (unusedCodes.length === 0) return null;

  for (const raw of tokens) {
    // Strip leading/trailing non-alphanumeric characters
    const token = raw.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
    if (!token) continue;

    const tokenHash = hashCode(token);
    const match = unusedCodes.find((c) => c.hash === tokenHash);
    if (match) {
      return { hash: tokenHash, index: match.index };
    }
  }
  return null;
}

/**
 * Mark a code as used.
 * @param {string} filePath
 * @param {{ codes: Array }} codesData - Mutated in place
 * @param {number} index
 * @param {string} pubkey - Redeemer's hex pubkey
 * @param {string} eventId - Note event ID
 */
export function markCodeUsed(filePath, codesData, index, pubkey, eventId) {
  codesData.codes[index].used = true;
  codesData.codes[index].usedBy = pubkey;
  codesData.codes[index].usedAt = new Date().toISOString();
  codesData.codes[index].usedOnEvent = eventId;
  saveCodes(filePath, codesData);
}

/**
 * Record a failed zap, scheduling retry in 30 minutes.
 * @param {string} filePath
 * @param {{ codes: Array }} codesData
 * @param {number} index
 */
export function markZapFailed(filePath, codesData, index) {
  codesData.codes[index].zapFailed = true;
  codesData.codes[index].zapRetryAt = new Date(
    Date.now() + ZAP_RETRY_DELAY_MS
  ).toISOString();
  saveCodes(filePath, codesData);
}

/**
 * Clear zap failure after successful retry.
 * @param {string} filePath
 * @param {{ codes: Array }} codesData
 * @param {number} index
 */
export function clearZapFailed(filePath, codesData, index) {
  codesData.codes[index].zapFailed = false;
  codesData.codes[index].zapRetryAt = null;
  saveCodes(filePath, codesData);
}

/**
 * Get codes with pending zap retries that are due now.
 * @param {{ codes: Array }} codesData
 * @returns {Array<{ index: number, usedOnEvent: string }>}
 */
export function getZapRetries(codesData) {
  const now = new Date().toISOString();
  return codesData.codes
    .map((c, i) => ({ ...c, index: i }))
    .filter((c) => c.zapFailed && c.zapRetryAt && c.zapRetryAt <= now)
    .map((c) => ({ index: c.index, usedOnEvent: c.usedOnEvent }));
}
