#!/usr/bin/env node

/**
 * CLI tool for managing redeem codes.
 *
 * Usage:
 *   node manage-codes.js add <code>        Add a new redeem code
 *   node manage-codes.js add-batch <file>  Add codes from a file (one per line)
 *   node manage-codes.js list              List all codes with status
 *   node manage-codes.js stats             Show summary statistics
 */

import { config } from "./src/config.js";
import { loadCodes, addCode } from "./src/codes.js";
import { readFileSync } from "fs";

const command = process.argv[2];
const arg = process.argv[3];
const codesFile = config.codesFile;

switch (command) {
  case "add": {
    if (!arg) {
      console.error("Usage: node manage-codes.js add <code>");
      process.exit(1);
    }
    try {
      const hash = addCode(codesFile, arg);
      console.log(`Code added. Hash: ${hash}`);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
    break;
  }

  case "add-batch": {
    if (!arg) {
      console.error("Usage: node manage-codes.js add-batch <file>");
      process.exit(1);
    }
    const lines = readFileSync(arg, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let added = 0;
    for (const line of lines) {
      try {
        addCode(codesFile, line);
        added++;
      } catch (err) {
        console.warn(`  Skipped "${line}": ${err.message}`);
      }
    }
    console.log(`Added ${added}/${lines.length} codes to ${codesFile}`);
    break;
  }

  case "list": {
    const data = loadCodes(codesFile);
    if (data.codes.length === 0) {
      console.log("No codes found.");
      break;
    }
    for (const code of data.codes) {
      const status = code.used
        ? `USED by ${code.usedBy?.slice(0, 12)}... at ${code.usedAt}`
        : "AVAILABLE";
      const retry = code.zapFailed ? ` [ZAP RETRY pending]` : "";
      console.log(`  ${code.hash.slice(0, 16)}... [${status}]${retry}`);
    }
    break;
  }

  case "stats": {
    const data = loadCodes(codesFile);
    const total = data.codes.length;
    const used = data.codes.filter((c) => c.used).length;
    const zapRetries = data.codes.filter((c) => c.zapFailed).length;
    console.log(`Total: ${total} | Used: ${used} | Available: ${total - used} | Zap retries pending: ${zapRetries}`);
    break;
  }

  default:
    console.log("Usage: node manage-codes.js <command>");
    console.log("");
    console.log("Commands:");
    console.log("  add <code>        Add a new redeem code");
    console.log("  add-batch <file>  Add codes from a file (one per line)");
    console.log("  list              List all codes with status");
    console.log("  stats             Show summary statistics");
    process.exit(1);
}
