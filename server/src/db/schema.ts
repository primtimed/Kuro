export const SCHEMA = `
-- Global credentials: one record per streaming service, shared by all profiles
CREATE TABLE IF NOT EXISTS service_credentials (
  service_id TEXT NOT NULL PRIMARY KEY,
  email TEXT,
  password_enc TEXT,
  display_name TEXT,
  updated_at INTEGER NOT NULL
);

-- Per-profile: which services are enabled for each Kuro user
CREATE TABLE IF NOT EXISTS user_services (
  account_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (account_id, service_id)
);

CREATE TABLE IF NOT EXISTS kuro_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS media_service_tags (
  media_id TEXT NOT NULL PRIMARY KEY,
  service_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  media_id TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '1',
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  poster TEXT,
  added_at INTEGER NOT NULL,
  content_tag TEXT NOT NULL DEFAULT 'anime',
  PRIMARY KEY (media_id, account_id)
);

CREATE TABLE IF NOT EXISTS history (
  media_id TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '1',
  episode_number INTEGER NOT NULL DEFAULT 0,
  progress_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  last_watched INTEGER NOT NULL,
  is_dub INTEGER NOT NULL DEFAULT 0,
  content_tag TEXT NOT NULL DEFAULT 'anime',
  PRIMARY KEY (media_id, account_id, episode_number)
);

CREATE TABLE IF NOT EXISTS likes (
  media_id TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '1',
  rating INTEGER NOT NULL DEFAULT 3,
  title TEXT NOT NULL,
  poster TEXT,
  liked_at INTEGER NOT NULL,
  content_tag TEXT NOT NULL DEFAULT 'anime',
  PRIMARY KEY (media_id, account_id)
);

CREATE TABLE IF NOT EXISTS recommendations (
  account_id TEXT NOT NULL,
  media_id TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 1,
  media_json TEXT,
  PRIMARY KEY (account_id, media_id)
);

CREATE TABLE IF NOT EXISTS recommendation_meta (
  account_id TEXT NOT NULL PRIMARY KEY,
  last_updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS favorite_series (
  media_id TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '1',
  title TEXT NOT NULL,
  poster TEXT,
  added_at INTEGER NOT NULL,
  content_tag TEXT NOT NULL DEFAULT 'anime',
  PRIMARY KEY (media_id, account_id)
);

CREATE TABLE IF NOT EXISTS watched_shows (
  media_id TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '1',
  title TEXT NOT NULL,
  poster TEXT,
  marked_at INTEGER NOT NULL,
  content_tag TEXT NOT NULL DEFAULT 'anime',
  PRIMARY KEY (media_id, account_id)
);
`;

export const MIGRATIONS = `
ALTER TABLE favorites RENAME TO favorites_old;
CREATE TABLE favorites (
  media_id TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '1',
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  poster TEXT,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (media_id, account_id)
);
INSERT INTO favorites SELECT media_id, '1', type, title, poster, added_at FROM favorites_old;
DROP TABLE favorites_old;

ALTER TABLE history RENAME TO history_old;
CREATE TABLE history (
  media_id TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '1',
  episode_number INTEGER NOT NULL DEFAULT 0,
  progress_seconds INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER,
  last_watched INTEGER NOT NULL,
  PRIMARY KEY (media_id, account_id, episode_number)
);
INSERT INTO history SELECT media_id, '1', episode_number, progress_seconds, duration_seconds, last_watched FROM history_old;
DROP TABLE history_old;
`;
