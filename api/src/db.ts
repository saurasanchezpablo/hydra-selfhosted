import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
export const ARTIFACTS_DIR = path.join(DATA_DIR, "artifacts");
export const IMAGES_DIR = path.join(DATA_DIR, "images");
export const CLOUD_SAVES_DIR = path.join(DATA_DIR, "cloud-saves");

fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });
fs.mkdirSync(CLOUD_SAVES_DIR, { recursive: true });

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
try { db.exec(`ALTER TABLE games ADD COLUMN session_started_at INTEGER`); } catch {}

// Fix image URLs stored as absolute paths
try { db.exec(`UPDATE users SET profile_image_url = REPLACE(profile_image_url, '/data/images/', '/images/') WHERE profile_image_url LIKE '/data/%'`); } catch {}
try { db.exec(`UPDATE users SET background_image_url = REPLACE(background_image_url, '/data/images/', '/images/') WHERE background_image_url LIKE '/data/%'`); } catch {}

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
  CREATE TABLE IF NOT EXISTS blocks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    blocked_user_id TEXT NOT NULL REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, blocked_user_id)
  );

  CREATE TABLE IF NOT EXISTS badges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    badge_type TEXT NOT NULL,
    badge_data TEXT,
    unlocked_at INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    data TEXT,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
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

try { db.exec(`ALTER TABLE users ADD COLUMN roles TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0`); } catch {}

// Cloud Saves v2 tables
db.exec(`
  CREATE TABLE IF NOT EXISTS cs_snapshots (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    shop TEXT NOT NULL,
    object_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    aggregate_hash TEXT NOT NULL,
    file_count INTEGER NOT NULL DEFAULT 0,
    total_size_bytes INTEGER NOT NULL DEFAULT 0,
    variants TEXT NOT NULL DEFAULT '[]',
    files TEXT NOT NULL DEFAULT '[]',
    custom_path_raw_paths TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_cs_snapshots_game
    ON cs_snapshots (user_id, shop, object_id);

  CREATE TABLE IF NOT EXISTS cs_pending (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    shop TEXT NOT NULL,
    object_id TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    base_version INTEGER NOT NULL DEFAULT 0,
    variants TEXT NOT NULL DEFAULT '[]',
    files TEXT NOT NULL DEFAULT '[]',
    custom_path_raw_paths TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    expires_at INTEGER NOT NULL DEFAULT (unixepoch() + 7200)
  );
  CREATE INDEX IF NOT EXISTS idx_cs_pending_user ON cs_pending (user_id);
`);

// Passkeys (WebAuthn)
db.exec(`
  CREATE TABLE IF NOT EXISTS passkeys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT NOT NULL DEFAULT '[]',
    label TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
  );
  CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys (user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_passkeys_credential ON passkeys (credential_id);
`);

// Global settings (singleton row)
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
try { db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('global_accent_color', '#d4a574')`); } catch {}

// Assign initial admin from env
const INITIAL_ADMIN = process.env.INITIAL_ADMIN_USERNAME;
if (INITIAL_ADMIN) {
  const row = db.prepare("SELECT id, roles FROM users WHERE username = ?").get(INITIAL_ADMIN) as { id: string; roles: string | null } | undefined;
  if (row) {
    let alreadyAdmin = false;
    try {
      const roles = JSON.parse(row.roles || "[]");
      alreadyAdmin = Array.isArray(roles) && roles.includes("admin");
    } catch {}
    if (!alreadyAdmin) {
      db.prepare("UPDATE users SET roles = ? WHERE id = ?").run(JSON.stringify(["admin"]), row.id);
      console.log(`[db] Assigned admin role to user "${INITIAL_ADMIN}"`);
    }
  }
}
