"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.CLOUD_SAVES_DIR = exports.IMAGES_DIR = exports.ARTIFACTS_DIR = void 0;
exports.enforceInitialAdmin = enforceInitialAdmin;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const DATA_DIR = process.env.DATA_DIR ?? "/data";
exports.ARTIFACTS_DIR = node_path_1.default.join(DATA_DIR, "artifacts");
exports.IMAGES_DIR = node_path_1.default.join(DATA_DIR, "images");
exports.CLOUD_SAVES_DIR = node_path_1.default.join(DATA_DIR, "cloud-saves");
node_fs_1.default.mkdirSync(exports.ARTIFACTS_DIR, { recursive: true });
node_fs_1.default.mkdirSync(exports.IMAGES_DIR, { recursive: true });
node_fs_1.default.mkdirSync(exports.CLOUD_SAVES_DIR, { recursive: true });
exports.db = new better_sqlite3_1.default(node_path_1.default.join(DATA_DIR, "hydra.db"));
exports.db.pragma("journal_mode = WAL");
exports.db.pragma("foreign_keys = ON");
exports.db.exec(`
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
// Migrations for existing databases
for (const col of ["steam_id", "steam_api_key", "accent_color", "custom_css"]) {
    try {
        exports.db.exec(`ALTER TABLE users ADD COLUMN ${col} TEXT`);
    }
    catch { }
}
try {
    exports.db.exec(`ALTER TABLE games ADD COLUMN executable_path TEXT`);
}
catch { }
try {
    exports.db.exec(`ALTER TABLE games ADD COLUMN pinned_at INTEGER`);
}
catch { }
try {
    exports.db.exec(`ALTER TABLE games ADD COLUMN source TEXT NOT NULL DEFAULT 'launcher'`);
}
catch { }
try {
    exports.db.exec(`CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    UNIQUE(user_id, name)
  )`);
}
catch { }
try {
    exports.db.exec(`ALTER TABLE users ADD COLUMN show_recent_activity INTEGER NOT NULL DEFAULT 1`);
}
catch { }
try {
    exports.db.exec(`ALTER TABLE users ADD COLUMN show_library INTEGER NOT NULL DEFAULT 1`);
}
catch { }
try {
    exports.db.exec(`ALTER TABLE users ADD COLUMN profile_sections_order TEXT`);
}
catch { }
try {
    exports.db.exec(`ALTER TABLE games ADD COLUMN session_started_at INTEGER`);
}
catch { }
// Fix image URLs stored as absolute paths
try {
    exports.db.exec(`UPDATE users SET profile_image_url = REPLACE(profile_image_url, '/data/images/', '/images/') WHERE profile_image_url LIKE '/data/%'`);
}
catch { }
try {
    exports.db.exec(`UPDATE users SET background_image_url = REPLACE(background_image_url, '/data/images/', '/images/') WHERE background_image_url LIKE '/data/%'`);
}
catch { }
try {
    exports.db.exec(`ALTER TABLE users ADD COLUMN roles TEXT`);
}
catch { }
try {
    exports.db.exec(`ALTER TABLE users ADD COLUMN is_banned INTEGER NOT NULL DEFAULT 0`);
}
catch { }
// Game visibility (launcher >= 4.1.4):
//   is_concealed          -> hidden from the owner's own library ("hidden library")
//   is_hidden_from_others -> hidden from the public profile
try {
    exports.db.exec(`ALTER TABLE games ADD COLUMN is_concealed INTEGER NOT NULL DEFAULT 0`);
}
catch { }
try {
    exports.db.exec(`ALTER TABLE games ADD COLUMN is_hidden_from_others INTEGER NOT NULL DEFAULT 0`);
}
catch { }
// Cloud Saves v2 tables
exports.db.exec(`
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
exports.db.exec(`
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
exports.db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
try {
    exports.db.exec(`INSERT OR IGNORE INTO settings (key, value) VALUES ('global_accent_color', '#d4a574')`);
}
catch { }
// Export for on-demand initial admin assignment
function enforceInitialAdmin() {
    const INITIAL_ADMIN = process.env.INITIAL_ADMIN_USERNAME;
    if (!INITIAL_ADMIN) {
        const anyAdmin = exports.db.prepare("SELECT 1 FROM users WHERE roles LIKE '%admin%'").get();
        if (anyAdmin)
            return;
        const firstUser = exports.db.prepare("SELECT id FROM users ORDER BY created_at ASC LIMIT 1").get();
        if (!firstUser)
            return;
        exports.db.prepare("UPDATE users SET roles = ? WHERE id = ?").run(JSON.stringify(["admin"]), firstUser.id);
        console.log(`[db] No admin found — auto-promoted first user to admin`);
        return;
    }
    const row = exports.db.prepare("SELECT id, roles FROM users WHERE username = ?").get(INITIAL_ADMIN);
    if (!row)
        return;
    let alreadyAdmin = false;
    try {
        const roles = JSON.parse(row.roles || "[]");
        alreadyAdmin = Array.isArray(roles) && roles.includes("admin");
    }
    catch { }
    if (!alreadyAdmin) {
        exports.db.prepare("UPDATE users SET roles = ? WHERE id = ?").run(JSON.stringify(["admin"]), row.id);
        console.log(`[db] Assigned admin role to user "${INITIAL_ADMIN}"`);
    }
}
// Run once at startup too
enforceInitialAdmin();
