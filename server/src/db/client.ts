import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { SCHEMA, MIGRATIONS } from "./schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "../../streamvault.db");

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

// Seed the household from the profiles that used to be hardcoded in the client
const hasProfiles = db.prepare("SELECT COUNT(*) FROM profiles").pluck().get() as number;
if (!hasProfiles) {
  const seed = db.prepare(
    "INSERT INTO profiles (id, name, color, initial, is_admin, is_shared, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  );
  const now = Date.now();
  db.transaction(() => {
    seed.run("1", "Familie", "#e50914", "Fa", 0, 1, 1, now);
    seed.run("2", "Ronny", "#3b82f6", "Ro", 0, 0, 2, now);
    seed.run("3", "Mellanie", "#a855f7", "Me", 0, 0, 3, now);
    seed.run("4", "Brian", "#22c55e", "Br", 1, 0, 4, now);
    seed.run("5", "Romy", "#f59e0b", "Ry", 0, 0, 5, now);
  })();
}

addContentTag("favorites");
addContentTag("history");
addContentTag("likes");
addContentTag("favorite_series");
addContentTag("watched_shows");

export default db;
