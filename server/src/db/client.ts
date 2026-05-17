import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { SCHEMA, MIGRATIONS } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../../streamvault.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(SCHEMA);

// Migrate existing tables that lack account_id
const favHasCol = db
  .prepare("SELECT COUNT(*) FROM pragma_table_info('favorites') WHERE name='account_id'")
  .pluck()
  .get() as number;

if (!favHasCol) {
  db.exec(MIGRATIONS);
}

// Add is_dub column to history if not present (added for per-episode audio tracking)
const historyHasIsDub = db
  .prepare("SELECT COUNT(*) FROM pragma_table_info('history') WHERE name='is_dub'")
  .pluck()
  .get() as number;

if (!historyHasIsDub) {
  db.exec("ALTER TABLE history ADD COLUMN is_dub INTEGER NOT NULL DEFAULT 0");
}

// Add content_tag column to all library tables, then back-fill TV rows
function addContentTag(table: string) {
  const hasCol = db
    .prepare(`SELECT COUNT(*) FROM pragma_table_info('${table}') WHERE name='content_tag'`)
    .pluck()
    .get() as number;
  if (!hasCol) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN content_tag TEXT NOT NULL DEFAULT 'anime'`);
    db.exec(`UPDATE ${table} SET content_tag = 'tv' WHERE media_id LIKE 'tvmaze:%'`);
  }
}

addContentTag("favorites");
addContentTag("history");
addContentTag("likes");
addContentTag("favorite_series");
addContentTag("watched_shows");

export default db;
