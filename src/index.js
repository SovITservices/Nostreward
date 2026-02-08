import { validateConfig } from "./config.js";
import { initBot, zapNote, repostNote } from "./bot.js";

async function main() {
  const noteId = process.argv[2];

  if (!noteId) {
    console.log("Usage: node src/index.js <note_id>");
    console.log("");
    console.log("  note_id: A Nostr event ID (hex, note1..., or nevent1...)");
    console.log("");
    console.log("The bot will zap and repost the given note.");
    console.log("Configure via .env file (see .env.example).");
    process.exit(1);
  }

  validateConfig();
  await initBot();

  try {
    // Both zap and repost the note
    await zapNote(noteId);
    await repostNote(noteId);
    console.log("\nDone! Note has been zapped and reposted.");
  } catch (err) {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  }

  // Give time for events to propagate, then exit
  setTimeout(() => process.exit(0), 3000);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
