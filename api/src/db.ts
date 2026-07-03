import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
export const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
export const IMAGES_DIR = path.join(DATA_DIR, "images");

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "hydra.db"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Migrations for existing databases
for (const col of ["steam_id", "steam_api_key", "accent_color", "custom_css"]) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`); } catch {}
}
try { db.exec(`ALTER TABLE games ADD COLUMN executable_path TEXT`); } catch {}
try { db.exec(`ALTER TABLE games ADD COLUMN pinned_at INTEGER`); } catch {}
try { db.exec(`ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT 'launcher'`); } catch {}
try {
  db.exec(`CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, name)
  )`);
} catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN show_recent_activity INTEGER NOT NULL DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN show_library INTEGER NOT NULL DEFAULT 1`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN profile_sections_order TEXT`); } catch {}

// Fix image URLs stored as absolute paths
db.exec(`UPDATE users SET profile_image_url = REPLACE(profile_image_url, '/data/images/', '/images/') WHERE profile_image_url LIKE '/data/%'`);
db.exec(`UPDATE users SET background_image_url = REPLACE(background_image_url, '/data/images/', '/images/') WHERE background_image_url LIKE '/data/%'`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    profile_image_url TEXT,
    background_image_url TEXT,
    bio TEXT NOT NULL DEFAULT '',
    steam_id TEXT,
    steam_api_key TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    object_id TEXT NOT NULL,
    shop TEXT NOT NULL,
    title TEXT NOT NULL,
    play_time_in_seconds INTEGER NOT NULL DEFAULT 0,
    last_time_played INTEGER,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    collection_ids TEXT NOT NULL DEFAULT '[]',
    UNIQUE(user_id, object_id, shop)
  );

  CREATE TABLE IF NOT EXISTS achievements (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    object_id TEXT NOT NULL,
    shop TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    unlocked_at INTEGER NOT NULL,
    UNIQUE(user_id, object_id, shop, achievement_id)
  );

  CREATE TABLE IF NOT EXISTS artifacts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    object_id TEXT NOT NULL,
    shop TEXT NOT NULL,
    hostname TEXT NOT NULL,
    wine_prefix_path TEXT,
    home_dir TEXT NOT NULL,
    download_option_title TEXT,
    platform TEXT NOT NULL,
    label TEXT,
    artifact_length_in_bytes INTEGER NOT NULL DEFAULT 0,
    file_path TEXT,
    is_frozen INTEGER NOT NULL DEFAULT 0,
    download_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL REFERENCES users(id),
    addressee_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(requester_id, addressee_id)
  );
`);
