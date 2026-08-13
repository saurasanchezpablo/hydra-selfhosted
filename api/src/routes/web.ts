import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import bcrypt from "bcryptjs";
import { db, IMAGES_DIR, enforceInitialAdmin } from "../db";
import { signAccess, verifyToken } from "../auth";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
} from "@simplewebauthn/types";

const RP_NAME = "Hydra Self-Hosted";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? `http://localhost:${process.env.PORT ?? "3000"}`;
import { syncSteamGames } from "../steam-sync";

interface DbUser {
  id: string;
  username: string;
  display_name: string;
  bio: string;
  profile_image_url: string | null;
  background_image_url: string | null;
  steam_id: string | null;
  steam_api_key: string | null;
  accent_color: string | null;
  custom_css: string | null;
  created_at: number;
  show_recent_activity: number;
  show_library: number;
  profile_sections_order: string | null;
  roles: string | null;
  is_banned: number;
}

interface DbGame {
  object_id: string;
  title: string;
  play_time_in_seconds: number;
  shop: string;
  source?: string;
  is_pinned?: number;
  pinned_at?: number | null;
  is_favorite?: number;
  last_time_played?: number | null;
  session_started_at?: number | null;
}

interface CurrentGame {
  title: string;
  objectId: string;
  shop: string;
  sessionDurationInSeconds: number;
}

function hashPassword(p: string) {
  return bcrypt.hashSync(p, 10);
}

function verifyPassword(p: string, hash: string) {
  if (hash.length === 64) {
    const sha = require("node:crypto").createHash("sha256").update(p).digest("hex");
    return sha === hash;
  }
  return bcrypt.compareSync(p, hash);
}

function h(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function resolveCurrentGame(user: DbUser, userId: string): Promise<CurrentGame | null> {
  const nowTs = Math.floor(Date.now() / 1000);
  const SESSION_TIMEOUT = 360;

  if (user.steam_id && user.steam_api_key) {
    try {
      const res = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(user.steam_api_key)}&steamids=${encodeURIComponent(user.steam_id)}`,
        { signal: AbortSignal.timeout(3000) }
      );
      if (res.ok) {
        const data = await res.json() as any;
        const player = data?.response?.players?.[0];
        if (player?.gameextrainfo && player?.gameid) {
          const steamObjectId = String(player.gameid);
          const dbGame = db.prepare(
            "SELECT session_started_at FROM games WHERE user_id = ? AND object_id = ? AND shop = 'steam' AND is_deleted = 0"
          ).get(userId, steamObjectId) as { session_started_at: number | null } | undefined;
          const sessionStartedAt = dbGame?.session_started_at ?? nowTs;
          return { title: player.gameextrainfo, objectId: steamObjectId, shop: "steam", sessionDurationInSeconds: nowTs - sessionStartedAt };
        }
      }
    } catch {}
  }

  const active = db.prepare(
    "SELECT object_id, title, shop, session_started_at FROM games WHERE user_id = ? AND is_deleted = 0 AND session_started_at IS NOT NULL AND last_time_played >= ? ORDER BY last_time_played DESC LIMIT 1"
  ).get(userId, nowTs - SESSION_TIMEOUT) as { object_id: string; title: string; shop: string; session_started_at: number } | undefined;

  if (active) {
    return { title: active.title, objectId: active.object_id, shop: active.shop, sessionDurationInSeconds: nowTs - active.session_started_at };
  }
  return null;
}

function fmtHours(seconds: number) {
  const h = Math.floor(seconds / 3600);
  if (h >= 1000) return `${h.toLocaleString()}h`;
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function fmtRelative(unixSec: number | null | undefined): string {
  if (!unixSec) return "";
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSec * 1000).toLocaleDateString();
}

function parseSectionsOrder(raw: string | null): string[] {
  try {
    const arr = JSON.parse(raw || '["games","recent"]');
    const mapped = arr.map((k: string) => k === "library" ? "games" : k);
    const valid = ["games", "recent"];
    const filtered = mapped.filter((k: string) => valid.includes(k));
    for (const k of valid) if (!filtered.includes(k)) filtered.push(k);
    return filtered;
  } catch { return ["games", "recent"]; }
}

function recentActivityHtml(games: DbGame[]): string {
  const seen = new Set<string>();
  const recent = [...games]
    .filter(g => g.last_time_played)
    .sort((a, b) => (b.last_time_played ?? 0) - (a.last_time_played ?? 0))
    .filter(g => { const k = `${g.shop}:${g.object_id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 5);
  if (!recent.length) return `<p style="color:var(--text-2);font-size:13px;padding:8px 0">No recent activity.</p>`;
  return `<table><thead><tr><th>Game</th><th>Playtime</th><th>Last played</th></tr></thead><tbody>` +
    recent.map(g => `<tr><td>${h(g.title)}</td><td>${fmtHours(g.play_time_in_seconds)}</td><td>${fmtRelative(g.last_time_played)}</td></tr>`).join("") +
    `</tbody></table>`;
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&family=Onest:wght@400;500;600;700;800&display=swap');
  :root {
    --bg-0: #0f0f0f;
    --bg-1: #1a1a1a;
    --bg-2: #222;
    --bg-3: #2a2a2a;
    --bg-hover: #252525;
    --text-0: #ddd;
    --text-1: #999;
    --text-2: #666;
    --border-1: #2a2a2a;
    --border-2: #333;
    --accent: #d4a574;
    --accent-bright: #e0b685;
    --accent-glow: #1c1a15;
    --border-acc: rgba(212,165,116,0.25);
    --err: #d77;
    --ok: #7a9;
    --font-sans: 'Onest', system-ui, -apple-system, sans-serif;
    --font-display: 'Onest', system-ui, -apple-system, sans-serif;
    --font-mono: 'JetBrains Mono', ui-monospace, 'Cascadia Code', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; scrollbar-width: thin; scrollbar-color: var(--border-2) var(--bg-0); }
  ::selection { background: var(--border-acc); color: var(--text-0); }
  body {
    background: var(--bg-0);
    color: var(--text-0);
    font-family: var(--font-sans);
    font-size: 14px;
    min-height: 100vh;
    line-height: 1.5;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 0 16px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  h1 { font-family: var(--font-display); font-size: 1.4rem; font-weight: 700; color: var(--text-0); letter-spacing: -0.3px; }
  h2 { font-size: 13px; color: var(--text-1); font-weight: 400; }
  h3 {
    font-family: var(--font-display);
    font-size: 0.9rem;
    color: var(--text-0);
    margin: 0 0 8px;
    font-weight: 600;
  }
  label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-2);
    margin-bottom: 3px;
    font-weight: 500;
  }
  input, textarea, select {
    width: 100%;
    background: var(--bg-2);
    border: 1px solid var(--border-2);
    border-radius: 0;
    padding: 6px 8px;
    color: var(--text-0);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    outline: none;
    transition: border-color 0.15s;
  }
  input:focus, textarea:focus, select:focus { border-color: var(--border-acc); }
  textarea { resize: vertical; min-height: 60px; }
  .field { margin-bottom: 10px; }
  button, .btn {
    background: var(--accent);
    color: var(--btn-contrast, var(--bg-0));
    border: 1px solid var(--accent);
    border-radius: 0;
    padding: 6px 12px;
    font-family: var(--font-sans);
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    width: 100%;
    transition: border-color 0.15s, color 0.15s, transform 0.1s;
  }
  button:hover, .btn:hover { background: var(--accent-bright); border-color: var(--accent-bright); }
  button:active { transform: scale(0.98); }
  .btn-ghost {
    background: transparent;
    border: 1px solid var(--border-2);
    color: var(--text-0);
  }
  .btn-ghost:hover { border-color: var(--border-acc); color: var(--accent); background: var(--accent-glow); }
  .err {
    background: rgba(221,119,119,0.08);
    border: 1px solid rgba(221,119,119,0.25);
    padding: 8px 12px;
    font-size: 0.75rem;
    color: var(--err);
    margin-bottom: 10px;
  }
  .ok {
    background: rgba(119,170,153,0.08);
    border: 1px solid rgba(119,170,153,0.25);
    padding: 8px 12px;
    font-size: 0.75rem;
    color: var(--ok);
    margin-bottom: 10px;
  }
  .warn {
    background: var(--accent-glow);
    border: 1px solid var(--border-acc);
    padding: 8px 12px;
    font-size: 0.75rem;
    color: var(--accent);
    margin-bottom: 10px;
  }
  .card {
    background: var(--bg-1);
    border: 1px solid var(--border-1);
    padding: 16px;
    margin-bottom: 8px;
    transition: border-color 0.15s;
  }
  .card:hover { border-color: var(--border-2); }
  .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .card.wide { max-width: 100%; padding: 0; }
  .row { display: flex; gap: 8px; }
  .row button { flex: 1; }
  .token-box {
    background: var(--bg-2);
    border: 1px solid var(--border-2);
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    word-break: break-all;
    color: var(--text-1);
  }
  .tab-btn {
    background: transparent;
    border: 1px solid var(--border-2);
    color: var(--text-1);
    width: auto;
    padding: 4px 12px;
    font-size: 0.8rem;
    border-radius: 0;
    font-family: var(--font-sans);
    font-weight: 500;
  }
  .tab-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--btn-contrast, var(--bg-0));
  }
  .tab-btn:hover { opacity: 0.85; }
  th {
    color: var(--text-2);
    text-align: left;
    padding: 6px 8px;
    border-bottom: 1px solid var(--border-1);
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    font-family: var(--font-mono);
    font-weight: 500;
  }
  td {
    padding: 6px 8px;
    border-bottom: 1px solid var(--bg-2);
    color: var(--text-0);
    font-size: 0.8rem;
  }
  tr:last-child td { border-bottom: none; }
  table { width: 100%; border-collapse: collapse; }
  .tag {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    background: var(--accent-glow);
    border: 1px solid var(--border-acc);
    padding: 2px 6px;
    color: var(--accent);
    display: inline-block;
  }
  .tag-ok { background: rgba(119,170,153,0.1); border-color: rgba(119,170,153,0.3); color: var(--ok); }
  .tag-warn { background: rgba(221,119,119,0.08); border-color: rgba(221,119,119,0.25); color: var(--err); }
  .meta { font-size: 0.75rem; color: var(--text-2); text-align: center; margin-top: 12px; }
  input[type="checkbox"] { width: auto; }
  .section { padding: 8px 0; }
  .welcome { padding: 16px 0 8px; text-align: center; }
  .welcome h1 { font-family: var(--font-display); font-weight: 700; font-size: 1.4rem; }
  .welcome h1 .d { color: var(--accent); }
  .welcome p { color: var(--text-2); margin-top: 4px; font-size: 0.85rem; }
  .nav {
    border-bottom: 1px solid var(--border-1);
    padding: 8px 0;
    position: sticky;
    top: 0;
    z-index: 100;
    background: var(--bg-0);
  }
  .nav-inner {
    max-width: 1100px;
    margin: 0 auto;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .nav-logo {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    background: transparent;
    border: 1px solid var(--border-2);
    font-family: var(--font-display);
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-0);
    text-decoration: none;
    flex-shrink: 0;
    transition: border-color 0.15s;
  }
  .nav-logo:hover { border-color: var(--border-acc); text-decoration: none; }
  .nav-links {
    display: inline-flex;
    gap: 0;
    margin: 0 auto;
    padding: 2px;
  }
  .nav-links a {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    font-size: 0.76rem;
    color: var(--text-1);
    font-weight: 500;
    white-space: nowrap;
    text-decoration: none;
    transition: color 0.15s, background 0.15s;
  }
  .nav-links a:hover { color: var(--text-0); background: var(--bg-2); text-decoration: none; }
  .nav-links a.active {
    color: var(--accent);
    background: transparent;
    border-bottom: 2px solid var(--accent);
    padding-bottom: 2px;
  }
  .nav-controls {
    display: flex;
    gap: 5px;
    margin-left: auto;
    align-items: center;
    flex-shrink: 0;
  }
  .btn-icon {
    padding: 4px 9px;
    border: 1px solid var(--border-2);
    background: transparent;
    color: var(--text-1);
    font-size: 0.75rem;
    font-family: var(--font-mono);
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 28px;
    justify-content: center;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
  }
  .btn-icon:hover { border-color: var(--border-acc); color: var(--text-0); background: var(--bg-2); }
  .btn-icon svg { width: 12px; height: 12px; }
  .spacer { flex: 1; }
  @media (max-width: 680px) {
    body { padding: 0; }
    .wrap { padding: 0 12px; }
    .nav { padding: 6px 0; }
    .nav-inner { flex-wrap: wrap; gap: 6px; }
    .nav-links { display: none; flex-direction: column; width: 100%; margin: 0; padding: 4px; background: var(--bg-1); border: 1px solid var(--border-1); }
    .nav-links.open { display: flex; }
    .nav-links a { padding: 8px 12px; justify-content: flex-start; }
    .welcome h1 { font-size: 1.2rem; }
    .card { padding: 12px; }
    .card.wide { border-radius: 0; }
    input, select, textarea { font-size: 16px !important; }
    .nav-controls { gap: 4px; }
    .btn-icon { padding: 8px 12px; font-size: 0.8rem; }
  }
  @media (max-width: 420px) {
    .wrap { padding: 0 8px; }
    .card { padding: 10px; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
`;

function contrastColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? "#111111" : "#ffffff";
}

function page(title: string, body: string, accent = "#d4a574", customCss = "") {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)} — Hydra</title><style>${CSS}:root{--accent:${accent};--accent-bright:${accent}cc;--accent-glow:${accent}26;--border-acc:${accent}4d;--btn-contrast:${contrastColor(accent)}}${customCss ? customCss : ""}</style></head><body>${body}</body></html>`;
}

function getGlobalAccent(): string {
  return (db.prepare("SELECT value FROM settings WHERE key = 'global_accent_color'").get() as { value: string } | undefined)?.value ?? "#d4a574";
}

function tokenGatePage(error?: string) {
  const accent = getGlobalAccent();
  return page("Access", `
    <div class="wrap" style="display:flex;align-items:center;justify-content:center;min-height:100vh">
      <div class="card">
        <h1>Hydra Self-Hosted</h1>
        <h2>Enter your API token to continue</h2>
        ${error ? `<div class="err">${h(error)}</div>` : ""}
        <form method="POST" action="/web/gate">
          <div class="field"><label>API Token</label><input name="instance_token" type="password" autofocus required></div>
          <button type="submit">Continue</button>
        </form>
        <div class="row" style="margin-top:12px">
          <a href="/web/passkey-login" class="btn btn-ghost" style="display:inline-block;padding:8px 16px;font-size:0.8rem">Sign in with Passkey</a>
        </div>
      </div>
    </div>
  `, accent);
}

function loginPage(error?: string, launcher = false) {
  const accent = getGlobalAccent();
  return page("Sign in", `
    <div class="wrap" style="display:flex;align-items:center;justify-content:center;min-height:100vh">
      <div class="card">
        <h1>Hydra Self-Hosted</h1>
        <h2>Sign in to your account</h2>
        ${error ? `<div class="err">${h(error)}</div>` : ""}
        <form method="POST" action="/web/login">
          <input type="hidden" name="launcher" value="${launcher ? "1" : ""}">
          <div class="field"><label>Username</label><input name="username" autocomplete="username" required autofocus></div>
          <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
          <div class="row">
            <button type="submit" name="action" value="login">Sign in</button>
            <button type="submit" name="action" value="register" class="btn-ghost">Register</button>
          </div>
        </form>
        <div class="row" style="margin-top:12px;justify-content:center">
          <a href="/web/passkey-login${launcher ? "?launcher=1" : ""}" class="btn btn-ghost" style="display:inline-block;padding:8px 16px;font-size:0.8rem">Sign in with Passkey</a>
        </div>
        <p class="meta">Hydra Launcher self-hosted instance</p>
      </div>
    </div>
  `, accent);
}

function tabsHtml(hydraGames: DbGame[], steamGames: DbGame[], hasSteam: boolean, showRecent = true, sectionsOrder: string[] = ["games","recent"]) {
  const PIN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:4px;opacity:0.7"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`;
  const HEART_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="var(--err)" style="vertical-align:middle;margin-left:4px;flex-shrink:0"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
  const mkRows = (list: DbGame[]) => {
    const sorted = [...list.filter(g => g.is_pinned), ...list.filter(g => !g.is_pinned)];
    return sorted.slice(0, 100).map(g =>
      `<tr><td>${g.is_pinned ? PIN_ICON : ""}${h(g.title)}${g.is_favorite ? HEART_ICON : ""}</td><td>${fmtHours(g.play_time_in_seconds)}</td></tr>`
    ).join("") || `<tr><td colspan="2" style="color:var(--text-1)">No games yet.</td></tr>`;
  };

  const mkContent = (list: DbGame[]) => {
    const parts: Record<string,string> = {
      games: `<table><thead><tr><th>Game</th><th>Playtime</th></tr></thead><tbody>${mkRows(list)}</tbody></table>`,
      recent: showRecent ? `<h3>Recent Activity</h3>${recentActivityHtml(list)}` : "",
    };
    return sectionsOrder.map(k => parts[k] ?? "").join("");
  };

  return `
    <div class="tabs" style="margin-top:16px">
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="tab-btn active" data-tab="ph-hydra">Hydra (${hydraGames.length})</button>
        ${hasSteam ? `<button class="tab-btn" data-tab="ph-steam">Steam (${steamGames.length})</button>` : ""}
      </div>
      <div class="tab-panel" id="tab-ph-hydra">${mkContent(hydraGames)}</div>
      ${hasSteam ? `<div class="tab-panel" id="tab-ph-steam" style="display:none">${mkContent(steamGames)}</div>` : ""}
    </div>
    <script>
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
          btn.classList.add('active');
          document.getElementById('tab-' + btn.dataset.tab).style.display = '';
        });
      });
    </script>
  `;
}

function dashboardTabsHtml(hydraGames: DbGame[], steamGames: DbGame[], hasSteam: boolean) {
  const PIN_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" style="vertical-align:middle;margin-right:4px;opacity:0.7"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`;
  const HEART_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="var(--err)" style="vertical-align:middle;margin-left:4px;flex-shrink:0"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
  const mkRows = (list: DbGame[]) => {
    const sorted = [...list.filter(g => g.is_pinned), ...list.filter(g => !g.is_pinned)];
    return sorted.slice(0, 100).map(g => `
      <tr>
        <td>${g.is_pinned ? PIN_ICON : ""}${h(g.title)}${g.is_favorite ? HEART_ICON : ""}</td>
        <td>${fmtHours(g.play_time_in_seconds)}</td>
        <td style="text-align:right;white-space:nowrap">
          <form method="POST" action="/web/${g.is_favorite ? "unfavorite" : "favorite"}" style="display:inline;margin:0">
            <input type="hidden" name="shop" value="${h(g.shop)}">
            <input type="hidden" name="object_id" value="${h(g.object_id)}">
            <button type="submit" style="background:none;border:1px solid var(--border-1);border-radius:0;cursor:pointer;padding:2px 6px;font-size:11px;color:${g.is_favorite ? "var(--err)" : "var(--text-1)"};font-family:var(--font-sans);font-weight:500">${g.is_favorite ? "♥" : "♡"}</button>
          </form>
          <form method="POST" action="/web/${g.is_pinned ? "unpin" : "pin"}" style="display:inline;margin:0">
            <input type="hidden" name="shop" value="${h(g.shop)}">
            <input type="hidden" name="object_id" value="${h(g.object_id)}">
            <button type="submit" style="background:none;border:1px solid var(--border-1);border-radius:0;cursor:pointer;padding:2px 6px;font-size:11px;color:${g.is_pinned ? "var(--accent)" : "var(--text-1)"};font-family:var(--font-sans);font-weight:500">${g.is_pinned ? "Unpin" : "Pin"}</button>
          </form>
        </td>
      </tr>`).join("") || `<tr><td colspan="3" style="color:var(--text-1)">No games yet.</td></tr>`;
  };

  const mkPanel = (id: string, list: DbGame[]) => `
    <div class="tab-panel" id="tab-${id}" style="display:none">
      <table><thead><tr><th>Game</th><th>Playtime</th><th></th></tr></thead><tbody>${mkRows(list)}</tbody></table>
      <h3>Recent Activity</h3>
      ${recentActivityHtml(list)}
    </div>`;

  return `
    <div class="tabs" style="margin-top:16px">
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <button class="tab-btn active" data-tab="dh-hydra">Hydra (${hydraGames.length})</button>
        ${hasSteam ? `<button class="tab-btn" data-tab="dh-steam">Steam (${steamGames.length})</button>` : ""}
      </div>
      <div class="tab-panel" id="tab-dh-hydra">
        <table><thead><tr><th>Game</th><th>Playtime</th><th></th></tr></thead><tbody>${mkRows(hydraGames)}</tbody></table>
        <h3>Recent Activity</h3>
        ${recentActivityHtml(hydraGames)}
      </div>
      ${hasSteam ? mkPanel("dh-steam", steamGames) : ""}
    </div>
    <script>
      document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
          btn.classList.add('active');
          document.getElementById('tab-' + btn.dataset.tab).style.display = '';
        });
      });
    </script>
  `;
}

function dashboardPage(user: DbUser, games: DbGame[], msg?: string, msgType: "ok"|"err" = "ok") {
  const globalAccent = getGlobalAccent();
  const accent = user.accent_color || globalAccent;
  const totalHours = Math.floor(games.reduce((s, g) => s + g.play_time_in_seconds, 0) / 3600);
  const hydraGames = [...games].filter(g => g.source !== "steam_sync")
    .sort((a, b) => (b.is_pinned ?? 0) - (a.is_pinned ?? 0) || b.play_time_in_seconds - a.play_time_in_seconds);
  const steamGames = [...games].filter(g => g.source === "steam_sync")
    .sort((a, b) => (b.is_pinned ?? 0) - (a.is_pinned ?? 0) || b.play_time_in_seconds - a.play_time_in_seconds);

  const isAdmin = (() => {
    try {
      const roles = JSON.parse(user.roles || "[]");
      return Array.isArray(roles) && roles.includes("admin");
    } catch { return false; }
  })();

  const DASHBOARD_JS = [
    "const avatarWrap=document.getElementById('avatar-overlay')?.parentElement;",
    "const overlay=document.getElementById('avatar-overlay');",
    "if(avatarWrap&&overlay){avatarWrap.addEventListener('mouseenter',()=>overlay.style.opacity='1');avatarWrap.addEventListener('mouseleave',()=>overlay.style.opacity='0');}",
    "let cropOffX=0,cropOffY=0,cropDragStart=null;",
    "const modal=document.getElementById('crop-modal');",
    "const cropImg=document.getElementById('crop-img');",
    "const zoomSlider=document.getElementById('crop-zoom');",
    "const rotSlider=document.getElementById('crop-rotate');",
    "const FRAME=300;",
    "function updateCropTransform(){const z=parseFloat(zoomSlider.value),r=parseFloat(rotSlider.value);cropImg.style.transform='translate('+cropOffX+'px,'+cropOffY+'px) rotate('+r+'deg) scale('+z+')';}",
    "zoomSlider.oninput=updateCropTransform;rotSlider.oninput=updateCropTransform;",
    "cropImg.addEventListener('mousedown',e=>{cropDragStart={x:e.clientX-cropOffX,y:e.clientY-cropOffY};e.preventDefault();});",
    "document.addEventListener('mousemove',e=>{if(!cropDragStart)return;cropOffX=e.clientX-cropDragStart.x;cropOffY=e.clientY-cropDragStart.y;updateCropTransform();});",
    "document.addEventListener('mouseup',()=>{cropDragStart=null;});",
    "function openCrop(input){const file=input.files[0];if(!file)return;const url=URL.createObjectURL(file);cropImg.onload=()=>{cropImg.style.width=cropImg.style.height='300px';cropOffX=0;cropOffY=0;zoomSlider.value=1;rotSlider.value=0;updateCropTransform();};cropImg.src=url;modal.style.display='flex';}",
    "function closeCrop(){modal.style.display='none';document.getElementById('avatar-input').value='';}",
    "function applyCrop(){const canvas=document.createElement('canvas');canvas.width=canvas.height=FRAME;const ctx=canvas.getContext('2d');const z=parseFloat(zoomSlider.value),r=parseFloat(rotSlider.value)*Math.PI/180;ctx.save();ctx.translate(FRAME/2+cropOffX,FRAME/2+cropOffY);ctx.rotate(r);ctx.scale(z,z);ctx.drawImage(cropImg,-cropImg.naturalWidth/2,-cropImg.naturalHeight/2);ctx.restore();canvas.toBlob(blob=>{const fd=new FormData();fd.append('image',blob,'avatar.png');fetch('/web/upload-avatar',{method:'POST',body:fd}).then(()=>location.reload());closeCrop();},'image/png');}",
    "function uploadImg(input){const file=input.files[0];if(!file)return;const fd=new FormData();fd.append('image',file);fetch('/web/upload-banner',{method:'POST',body:fd}).then(()=>location.reload());}",
    "function removeBanner(){fetch('/web/remove-banner',{method:'POST'}).then(()=>location.reload());}",
    "async function loadPasskeys(){try{const r=await fetch('/web/passkeys/list');const pks=await r.json();const el=document.getElementById('passkey-list');if(!pks.length){el.innerHTML='<span style=\"color:var(--text-2);font-size:12px\">No passkeys registered.</span>';return;}el.innerHTML=pks.map(pk=>'<div style=\"display:flex;align-items:center;justify-content:space-between;background:var(--bg-2);padding:8px 12px;margin-bottom:4px\"><span style=\"font-size:12px\">'+(pk.label||'Passkey')+' <span style=\"color:var(--text-2)\">'+new Date(pk.createdAt).toLocaleDateString()+'</span></span><button onclick=\"deletePasskey(\\''+pk.id+'\\')\" style=\"background:none;border:1px solid var(--border-1);border-radius:0;cursor:pointer;padding:2px 8px;font-size:11px;color:var(--err);font-family:var(--font-mono);font-weight:500;width:auto\">Remove</button></div>').join('');}catch(e){document.getElementById('passkey-list').innerHTML='<span style=\"color:var(--text-2);font-size:12px\">Error loading passkeys</span>';}}",
    "async function deletePasskey(id){if(!confirm('Remove this passkey?'))return;await fetch('/web/passkeys/'+id,{method:'DELETE'});loadPasskeys();}",
    "function toB64Url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}",
    "function fromB64Url(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}",
    "function prepareCreateOptions(o){o.challenge=fromB64Url(o.challenge);o.user.id=fromB64Url(o.user.id);if(o.excludeCredentials)o.excludeCredentials=o.excludeCredentials.map(c=>({...c,id:fromB64Url(c.id)}));return o;}",
    "async function registerPasskey(){try{const optsRes=await fetch('/web/passkeys/register/options',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const opts=await optsRes.json();if(opts.error){alert(opts.error);return;}const cred=await navigator.credentials.create({publicKey:prepareCreateOptions(opts)});const credJson={id:cred.id,rawId:toB64Url(new Uint8Array(cred.rawId)),type:cred.type,response:{attestationObject:toB64Url(new Uint8Array(cred.response.attestationObject)),clientDataJSON:toB64Url(new Uint8Array(cred.response.clientDataJSON))},clientExtensionResults:typeof cred.getClientExtensionResults==='function'?cred.getClientExtensionResults():{}};const verifyRes=await fetch('/web/passkeys/register/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...credJson,label:navigator.userAgent.includes('Mobile')?'Mobile device':'Browser'})});const result=await verifyRes.json();if(result.verified){loadPasskeys();}else{alert(result.error||'Registration failed');}}catch(e){if(e.name!=='NotAllowedError')alert('Passkey error: '+e.message);}}",
  ].join("\n");

  return page("Dashboard", `
    <nav class="nav"><div class="nav-inner">
      <a href="/web/dashboard" class="nav-logo">Hydra</a>
      <div class="nav-links">
        <a href="/web/dashboard" class="active">Dashboard</a>
        <a href="/u/${h(user.username)}" target="_blank">Profile</a>
        ${isAdmin ? `<a href="/web/admin">Admin</a>` : ""}
      </div>
      <div class="nav-controls">
        <a href="/web/logout" class="btn-icon" style="text-decoration:none">Sign out</a>
      </div>
    </div></nav>
    <div class="wrap">
    <div class="card wide" style="padding:0;overflow:hidden">
      <div style="position:relative">
        ${user.background_image_url
          ? `<div id="banner" style="height:140px;background:url('${h(user.background_image_url)}') center/cover no-repeat;position:relative"></div>`
          : `<div id="banner" style="height:80px;background:var(--bg-2);position:relative"></div>`}
        <div style="position:absolute;top:8px;right:8px;display:flex;gap:6px">
          <label style="cursor:pointer;background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:4px 10px;border-radius:0;backdrop-filter:blur(4px);font-family:var(--font-mono)">
            ${user.background_image_url ? "Change banner" : "Set banner"}
            <input type="file" accept="image/*" style="display:none" onchange="uploadImg(this,'banner')">
          </label>
          ${user.background_image_url ? `<button onclick="removeBanner()" style="background:rgba(0,0,0,.6);color:#fff;font-size:11px;padding:4px 10px;border-radius:0;border:none;cursor:pointer;backdrop-filter:blur(4px);font-family:var(--font-mono);font-weight:500;width:auto">Remove</button>` : ""}
        </div>
      </div>
      <div style="padding:0 32px 32px">
        <div style="display:flex;align-items:flex-end;gap:16px;margin-top:${user.background_image_url ? "-36px" : "-16px"};margin-bottom:16px;position:relative;z-index:1">
          <div style="position:relative;flex-shrink:0;cursor:pointer" onclick="document.getElementById('avatar-input').click()" title="Change avatar">
            ${user.profile_image_url
              ? `<img src="${h(user.profile_image_url)}" id="avatar-preview" style="width:64px;height:64px;border:3px solid var(--bg-1);object-fit:cover;display:block">`
              : `<div id="avatar-preview" style="width:64px;height:64px;border:3px solid var(--bg-1);background:var(--bg-2);display:flex;align-items:center;justify-content:center;font-size:24px">⬡</div>`}
            <div style="position:absolute;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .15s" id="avatar-overlay">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.46a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            </div>
            <input type="file" id="avatar-input" accept="image/*" style="display:none" onchange="openCrop(this)">
          </div>
          <div>
            <div style="font-size:18px;color:var(--accent);font-weight:600;font-family:var(--font-sans)">${h(user.display_name || user.username)}</div>
            <div style="font-size:13px;color:var(--text-1)">@${h(user.username)} · ${games.length} games · ${totalHours.toLocaleString()}h</div>
          </div>
        </div>
      ${msg ? `<div class="${msgType}">${h(msg)}</div>` : ""}

      <h3>Security</h3>
      <form method="POST" action="/web/password">
        <div class="field"><label>Current password</label><input name="current_password" type="password" required autocomplete="current-password"></div>
        <div class="field"><label>New password</label><input name="new_password" type="password" required minlength="6" autocomplete="new-password"></div>
        <button type="submit">Change password</button>
      </form>

      <h3>Profile</h3>
      <form method="POST" action="/web/profile">
        <div class="field"><label>Username</label><input name="username" value="${h(user.username)}" maxlength="32" pattern="[a-zA-Z0-9_]+" title="Letters, numbers and underscores only"></div>
        <div class="field"><label>Display name</label><input name="display_name" value="${h(user.display_name)}" maxlength="64"></div>
        <div class="field"><label>Bio</label><textarea name="bio" maxlength="200">${h(user.bio)}</textarea></div>
        <div class="field"><label>Accent color</label><div style="display:flex;gap:8px;align-items:center"><input type="color" id="accent_picker" name="accent_color" value="${h(accent)}" style="width:40px;height:32px;padding:2px;cursor:pointer;border-radius:0" oninput="document.getElementById('accent_hex').value=this.value"><input id="accent_hex" name="accent_color_hex" value="${h(accent)}" maxlength="7" style="flex:1" placeholder="#d4a574" oninput="if(/^#[0-9a-fA-F]{6}$/.test(this.value))document.getElementById('accent_picker').value=this.value"></div></div>
        <div class="field"><label>Custom CSS <span style="color:var(--text-2);font-size:11px">(applied to dashboard &amp; public profile)</span></label><textarea name="custom_css" rows="6" style="font-family:var(--font-mono);font-size:12px" placeholder="/* e.g. body { background: #000; } */">${h(user.custom_css || "")}</textarea></div>
        <div class="field" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="show_recent_activity" id="show_recent" value="1"${user.show_recent_activity !== 0 ? " checked" : ""} style="width:auto">
          <label for="show_recent" style="margin:0;cursor:pointer">Show recent activity on public profile</label>
        </div>
        <div class="field" style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="show_library" id="show_library" value="1"${user.show_library !== 0 ? " checked" : ""} style="width:auto">
          <label for="show_library" style="margin:0;cursor:pointer">Show library on public profile</label>
        </div>
        <div class="field">
          <label>Section order inside each tab <span style="color:var(--text-2);font-size:11px">(drag to reorder)</span></label>
          <input type="hidden" name="profile_sections_order" id="sections_order_input" value="${h(JSON.stringify(parseSectionsOrder(user.profile_sections_order)))}">
          <ul id="sections-list" style="list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px">${(() => {
            const order = parseSectionsOrder(user.profile_sections_order);
            const labels: Record<string,string> = { games: "Game list", recent: "Recent Activity" };
            return order.map(k => `<li data-key="${k}" style="display:flex;align-items:center;gap:8px;background:var(--bg-2);padding:8px 12px;cursor:grab;user-select:none"><span style="opacity:.5">⠿</span> ${labels[k]??k}</li>`).join("");
          })()}</ul>
        </div>
        <button type="submit">Save profile</button>
      </form>
      <script>
      (function(){
        const list = document.getElementById('sections-list');
        const inp = document.getElementById('sections_order_input');
        if (!list || !inp) return;
        let drag = null;
        list.querySelectorAll('li').forEach(el => {
          el.setAttribute('draggable', 'true');
          el.addEventListener('dragstart', e => { drag = el; el.style.opacity = '.4'; e.dataTransfer.effectAllowed = 'move'; });
          el.addEventListener('dragend', () => { drag.style.opacity = ''; drag = null; updateOrder(); });
          el.addEventListener('dragover', e => { e.preventDefault(); if (drag && drag !== el) { const r = el.getBoundingClientRect(); list.insertBefore(drag, e.clientY < r.top + r.height / 2 ? el : el.nextSibling); }});
        });
        function updateOrder() { inp.value = JSON.stringify([...list.querySelectorAll('li')].map(li => li.dataset.key)); }
      })();
      </script>

      <h3>Steam integration</h3>
      <div class="warn">Your Steam API key is stored on this server. Use a dedicated key or one with minimal permissions.</div>
      <form method="POST" action="/web/steam">
        <div class="field"><label>SteamID64 <a href="https://steamid.io" target="_blank">↗ find yours</a></label><input name="steam_id" value="${h(user.steam_id ?? "")}" placeholder="76561198xxxxxxxxx"><p style="font-size:11px;color:var(--text-2);margin-top:4px">Go to <a href="https://steamid.io" target="_blank">steamid.io</a>, enter your Steam profile URL or username, copy the <strong>steamID64</strong> value.</p></div>
        <div class="field"><label>Steam Web API Key <a href="https://steamcommunity.com/dev/apikey" target="_blank">↗</a></label><input name="steam_api_key" type="password" value="${user.steam_api_key ? "••••••••" : ""}" placeholder="Leave blank to keep current" autocomplete="off"></div>
        <button type="submit">Save &amp; sync Steam now</button>
      </form>

      <h3>Library</h3>
      ${dashboardTabsHtml(hydraGames, steamGames, Boolean(user.steam_id))}

      <h3>Passkeys</h3>
      <p style="font-size:12px;color:var(--text-1);margin-bottom:8px">Use your device biometrics or security keys to sign in without a password.</p>
      <div id="passkey-list" style="margin-bottom:12px"><span style="color:var(--text-2);font-size:12px">Loading...</span></div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button type="button" onclick="registerPasskey()" style="width:auto;padding:8px 16px;font-size:12px">Register passkey</button>
      </div>

      ${isAdmin ? "" : ""}

      <h3>API access</h3>
      <p style="font-size:12px;color:var(--text-1);margin-bottom:8px">Use this URL in Hydra Launcher settings:</p>
      <div class="token-box">${h(process.env.PUBLIC_URL ?? "http://localhost:" + (process.env.PORT ?? "3000"))}</div>

      <div style="margin-top:24px;display:flex;gap:8px;flex-wrap:wrap">
        <a href="/u/${h(user.username)}" target="_blank" class="btn btn-ghost" style="display:inline-block;padding:6px 12px;font-size:0.75rem">Public profile ↗</a>
        ${isAdmin ? `<a href="/web/admin" class="btn btn-ghost" style="display:inline-block;padding:6px 12px;font-size:0.75rem">Admin ↗</a>` : ""}
      </div>
      </div>
    </div>

    <!-- Crop modal -->
    <div id="crop-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:1000;align-items:center;justify-content:center">
      <div style="background:var(--bg-1);padding:20px;width:340px;max-width:90vw;border:1px solid var(--border-1)">
        <div style="font-size:14px;font-weight:600;margin-bottom:12px">Crop avatar</div>
        <div style="position:relative;width:300px;height:300px;overflow:hidden;background:#000;margin:0 auto">
          <img id="crop-img" style="position:absolute;cursor:move;max-width:none;user-select:none">
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
          <label style="font-size:11px;color:var(--text-2);flex-shrink:0;font-family:var(--font-mono)">Zoom</label>
          <input type="range" id="crop-zoom" min="0.5" max="3" step="0.01" value="1" style="flex:1">
          <label style="font-size:11px;color:var(--text-2);flex-shrink:0;font-family:var(--font-mono)">Rotate</label>
          <input type="range" id="crop-rotate" min="-180" max="180" step="1" value="0" style="flex:1">
        </div>
        <div style="display:flex;gap:8px;margin-top:12px;justify-content:flex-end">
          <button onclick="closeCrop()" style="background:var(--bg-2);color:var(--text-1);width:auto;padding:8px 16px">Cancel</button>
          <button onclick="applyCrop()" style="width:auto;padding:8px 16px">Save avatar</button>
        </div>
      </div>
    </div>
    </div>

    <script>${DASHBOARD_JS}
      loadPasskeys();
      document.querySelectorAll('input[type="color"]').forEach(c=>{
        c.style.borderRadius='0';
        c.style.height='32px';
        c.style.padding='2px';
      });
    </script>
  `, accent, user.custom_css || "");
}

const DEFAULT_PROFILE_CSS = `*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg-0,#0f0f0f);color:var(--text-0,#ddd);font-family:system-ui,-apple-system,sans-serif;font-size:14px;min-height:100vh}a{color:inherit;text-decoration:none}.card.wide{max-width:100%;border:none;border-radius:0;border:1px solid var(--border-1,#2a2a2a)}.card.wide>div:first-child{height:220px!important;border-radius:0}.card.wide>div:nth-child(2){max-width:960px;margin:0 auto;padding:0 32px 48px!important}.card.wide>div:nth-child(2)>div:first-child{margin-top:-56px!important;margin-bottom:24px!important;align-items:flex-end}.card.wide>div:nth-child(2)>div:first-child img,.card.wide>div:nth-child(2)>div:first-child>div:first-child{width:96px!important;height:96px!important;border:3px solid #0f0f0f!important;box-shadow:0 4px 24px rgba(0,0,0,.6)}.card.wide h1{font-size:22px;font-weight:600;letter-spacing:-.3px;color:#fff}.card.wide h2{font-size:13px;font-weight:400;color:#999;margin-top:2px}.card.wide>div:nth-child(2)>div:nth-child(2){background:var(--bg-1,#1a1a1a);border:1px solid var(--border-1,#2a2a2a);padding:16px 24px;gap:32px!important;margin:0 0 24px!important;display:inline-flex!important}.card.wide>div:nth-child(2)>div:nth-child(2)>div{text-align:center}.card.wide>div:nth-child(2)>div:nth-child(2) span:first-child{font-size:20px!important;font-weight:700}.tab-btn{background:transparent;border:none;border-bottom:2px solid transparent;color:#999;font-size:13px;font-weight:500;padding:8px 4px;cursor:pointer;transition:color .15s,border-color .15s}.tab-btn.active,.tab-btn:hover{color:var(--accent,#d4a574);border-color:var(--accent,#d4a574)}.game-grid{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;margin-top:16px}.game-item{background:var(--bg-1,#1a1a1a);border:1px solid var(--border-1,#2a2a2a);overflow:hidden;transition:border-color .15s,transform .15s;cursor:default}.game-item:hover{border-color:var(--accent,#d4a574);transform:translateY(-2px)}.game-item img{width:100%;aspect-ratio:16/9;object-fit:cover}.game-item .info{padding:8px 10px}.game-item .title{font-size:12px;font-weight:500;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.game-item .sub{font-size:11px;color:#666;margin-top:2px}.current-game{display:inline-flex;align-items:center;gap:6px;background:var(--accent-glow,rgba(212,165,116,0.08));border:1px solid var(--border-acc,rgba(212,165,116,0.3));padding:4px 12px;font-size:12px;color:var(--accent,#d4a574);margin-top:12px}.current-game .dot{width:6px;height:6px;background:var(--accent,#d4a574);border-radius:50%;animation:pulse 2s infinite}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`;

function fmtDuration(seconds: number): string {
  if (seconds < 60) return "just now";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function publicProfilePage(user: DbUser, games: DbGame[], currentGame?: CurrentGame | null) {
  const accent = user.accent_color || getGlobalAccent();
  const totalHours = Math.floor(games.reduce((s, g) => s + g.play_time_in_seconds, 0) / 3600);
  const hydraGames = [...games].filter(g => g.source !== "steam_sync")
    .sort((a, b) => (b.is_pinned ?? 0) - (a.is_pinned ?? 0) || b.play_time_in_seconds - a.play_time_in_seconds);
  const steamGames = [...games].filter(g => g.source === "steam_sync")
    .sort((a, b) => (b.is_pinned ?? 0) - (a.is_pinned ?? 0) || b.play_time_in_seconds - a.play_time_in_seconds);
  const steamHours = Math.floor(steamGames.reduce((s, g) => s + g.play_time_in_seconds, 0) / 3600);

  const currentGameStat = currentGame
    ? `<div class="current-game"><span class="dot"></span><span>${h(currentGame.title)}</span></div>`
    : "";

  return page(`@${user.username}`, `
    <nav class="nav"><div class="nav-inner">
      <a href="/" class="nav-logo">Hydra</a>
      <div class="nav-links">
        <a href="/u/${h(user.username)}" class="active">Profile</a>
      </div>
      <div class="nav-controls"></div>
    </div></nav>
    <div class="wrap">
    <div class="card wide" style="padding:0;overflow:hidden">
      ${user.background_image_url ? `<div style="height:120px;background:url('${h(user.background_image_url)}') center/cover no-repeat;position:relative"></div>` : `<div style="height:60px;background:var(--bg-2)"></div>`}
      <div style="padding:0 32px 32px">
        <div style="display:flex;align-items:flex-end;gap:16px;margin-top:${user.background_image_url ? "-40px" : "-20px"};margin-bottom:16px;position:relative;z-index:1">
          ${user.profile_image_url
            ? `<img src="${h(user.profile_image_url)}" style="width:72px;height:72px;border:3px solid var(--bg-0);object-fit:cover;flex-shrink:0">`
            : `<div style="width:72px;height:72px;border:3px solid var(--bg-0);background:var(--bg-2);display:flex;align-items:center;justify-content:center;font-size:28px;flex-shrink:0">⬡</div>`}
          <div>
            <h1 style="margin:0">⬡ ${h(user.display_name || user.username)}</h1>
            <h2 style="margin:0">@${h(user.username)}${user.bio ? ` · ${h(user.bio)}` : ""}</h2>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:24px;margin:16px 0;font-size:13px;flex-wrap:wrap">
          <div><span style="color:var(--accent);font-size:18px;font-weight:600">${games.length}</span><br><span style="color:var(--text-1)">games</span></div>
          <div><span style="color:var(--accent);font-size:18px;font-weight:600">${totalHours.toLocaleString()}</span><br><span style="color:var(--text-1)">total hours</span></div>
          ${user.steam_id ? `<div><span style="color:var(--accent);font-size:18px;font-weight:600">${steamHours.toLocaleString()}</span><br><span style="color:var(--text-1)">steam hours</span></div>` : ""}
          ${currentGameStat}
        </div>
        ${user.show_library !== 0 ? tabsHtml(hydraGames, steamGames, Boolean(user.steam_id), user.show_recent_activity !== 0, parseSectionsOrder(user.profile_sections_order)) : ""}
        <p style="font-size:11px;color:var(--text-2);margin-top:16px">Powered by <a href="https://github.com/entitybtw/hydra-selfhosted">Hydra Self-Hosted</a></p>
      </div>
    </div>
    </div>
  `, accent, DEFAULT_PROFILE_CSS + (user.custom_css || ""));
}

function getUserFromCookie(req: FastifyRequest): DbUser | null {
  const token = (req as any).cookies?.["web_token"];
  if (!token) return null;
  try {
    const userId = verifyToken(token, "access");
    enforceInitialAdmin();
    return db.prepare("SELECT * FROM users WHERE id = ?").get(userId) as DbUser | null;
  } catch {
    return null;
  }
}

function passkeyLoginPage(launcher = false, callbackPort?: string) {
  const accent = getGlobalAccent();
  return page("Sign in with Passkey", `
    <div class="wrap" style="display:flex;align-items:center;justify-content:center;min-height:100vh">
      <div class="card" style="text-align:center">
        <h1>Hydra Self-Hosted</h1>
        <h2>Sign in with passkey</h2>
        <div id="status" style="font-size:0.8rem;color:var(--text-1);margin:16px 0">Click the button below to authenticate with your passkey.</div>
        <button id="passkey-btn" onclick="startPasskeyLogin()">Sign in with Passkey</button>
        <div id="error" class="err" style="display:none;margin-top:12px"></div>
        <p class="meta" style="margin-top:16px">After authentication you will be redirected back to Hydra.</p>
      </div>
    </div>
    <script>
      const LAUNCHER_PROTOCOL = "hydra-self-hosted://";
      function toB64Url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}
      function fromB64Url(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';const bin=atob(s);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u;}
      async function startPasskeyLogin() {
        const btn = document.getElementById("passkey-btn");
        const status = document.getElementById("status");
        const errorEl = document.getElementById("error");
        btn.disabled = true;
        btn.textContent = "Authenticating...";
        status.textContent = "Requesting passkey challenge...";
        errorEl.style.display = "none";
        try {
          const optsRes = await fetch("/passkeys/login/options", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          if (!optsRes.ok) throw new Error("Failed to get login options");
          const options = await optsRes.json();
          status.textContent = "Waiting for passkey...";
          options.challenge = fromB64Url(options.challenge);
          if (options.allowCredentials) options.allowCredentials = options.allowCredentials.map(c => ({ ...c, id: fromB64Url(c.id) }));
          const cred = await navigator.credentials.get({ publicKey: options });
          status.textContent = "Verifying...";
          const credJson = {
            id: cred.id,
            rawId: toB64Url(new Uint8Array(cred.rawId)),
            type: cred.type,
            response: {
              authenticatorData: toB64Url(new Uint8Array(cred.response.authenticatorData)),
              clientDataJSON: toB64Url(new Uint8Array(cred.response.clientDataJSON)),
              signature: toB64Url(new Uint8Array(cred.response.signature)),
              userHandle: cred.response.userHandle ? toB64Url(new Uint8Array(cred.response.userHandle)) : null,
            },
            clientExtensionResults: typeof cred.getClientExtensionResults === 'function' ? cred.getClientExtensionResults() : {},
          };
          const verifyRes = await fetch("/passkeys/login/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(credJson),
          });
          if (!verifyRes.ok) {
            const err = await verifyRes.json().catch(() => ({}));
            throw new Error(err.error || "Verification failed");
          }
          const { accessToken } = await verifyRes.json();
          status.textContent = "Authenticated! Redirecting to Hydra...";
${launcher
             ? callbackPort
               ? `window.location.href = "http://127.0.0.1:${callbackPort}/token/" + encodeURIComponent(accessToken);`
               : `const deepLink = LAUNCHER_PROTOCOL + "token/" + accessToken;
            window.location.href = deepLink;
            setTimeout(() => {
              const a = document.createElement("a");
              a.href = deepLink;
              a.textContent = "Click here if Hydra did not open";
              status.appendChild(document.createElement("br"));
              status.appendChild(a);
            }, 2000);`
            : `await fetch("/web/auto-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userToken: accessToken }) });
            window.location.href = "/web/dashboard";`}
        } catch (e) {
          status.textContent = "";
          btn.disabled = false;
          btn.textContent = "Sign in with Passkey";
          errorEl.textContent = e.message || "Passkey authentication failed";
          errorEl.style.display = "block";
        }
      }
      startPasskeyLogin();
    </script>
  `, accent);
}

export async function webRoutes(app: FastifyInstance) {
  app.get("/", async (req: FastifyRequest<{ Querystring: { launcher?: string } }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (user) return reply.redirect("/web/dashboard");
    const gate = (req as any).cookies?.["gate_ok"];
    if (gate !== "1") return reply.type("text/html").send(tokenGatePage());
    const launcher = (req.query as any).launcher === "1";
    return reply.type("text/html").send(loginPage(undefined, launcher));
  });

  app.get("/web/passkey-login", async (req: FastifyRequest, reply: FastifyReply) => {
    const launcher = (req.query as any).launcher === "1";
    const callbackPort = (req.query as any).callback_port as string | undefined;
    return reply.type("text/html").send(passkeyLoginPage(launcher, callbackPort));
  });

  app.post("/web/launcher-gate", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const secret = process.env.API_TOKEN;
    if (!secret || req.body?.token !== secret) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return reply
      .setCookie("gate_ok", "1", { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 7 })
      .send({ ok: true });
  });

  app.post("/web/auto-login", {
    config: { rawBody: true },
  }, async (
    req: FastifyRequest<{ Body: { userToken?: string } }>,
    reply: FastifyReply
  ) => {
    const userToken = req.body?.userToken;
    if (!userToken) return reply.code(400).send({ error: "missing userToken" });
    let userId: string;
    try {
      userId = verifyToken(userToken, "access");
    } catch (e: any) {
      if (e?.name !== "TokenExpiredError") return reply.code(403).send({ error: "invalid token" });
      const jwt = await import("jsonwebtoken");
      const decoded = jwt.default.decode(userToken) as any;
      userId = decoded?.sub;
      if (!userId) return reply.code(403).send({ error: "invalid token" });
    }
    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(userId);
    if (!user) return reply.code(404).send({ error: "user not found" });
    const webToken = signAccess(userId);
    return reply
      .setCookie("gate_ok", "1", { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 7 })
      .setCookie("web_token", webToken, { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
      .send({ ok: true });
  });

  app.post("/web/gate", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const secret = process.env.API_TOKEN;
    if (!secret || req.body?.instance_token !== secret) {
      return reply.type("text/html").send(tokenGatePage("Invalid token."));
    }
    return reply
      .setCookie("gate_ok", "1", { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 7 })
      .redirect("/");
  });

  app.post("/web/login", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const { username, password, action, launcher } = req.body ?? {};
    const isLauncher = launcher === "1";

    if (action === "register") {
      if (!username || !password) return reply.type("text/html").send(loginPage("Username and password required.", isLauncher));
      const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(username);
      if (existing) return reply.type("text/html").send(loginPage("Username already taken.", isLauncher));

      const id = crypto.randomUUID();
      db.prepare("INSERT INTO users (id, username, password_hash, display_name) VALUES (?,?,?,?)")
        .run(id, username, hashPassword(password), username);

      const token = signAccess(id);
      if (isLauncher) return reply.redirect(`hydra-self-hosted://token/${token}`);
      return reply
        .setCookie("web_token", token, { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
        .redirect("/web/dashboard");
    }

    const user = db.prepare("SELECT id, password_hash FROM users WHERE username = ?")
      .get(username) as { id: string; password_hash: string } | undefined;

    if (!user || !verifyPassword(password, user.password_hash)) {
      return reply.type("text/html").send(loginPage("Invalid username or password.", isLauncher));
    }

    const token = signAccess(user.id);
    if (isLauncher) return reply.redirect(`hydra-self-hosted://token/${token}`);
    return reply
      .setCookie("web_token", token, { path: "/", httpOnly: true, maxAge: 60 * 60 * 24 * 30 })
      .redirect("/web/dashboard");
  });

  app.get("/web/dashboard", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
    return reply.type("text/html").send(dashboardPage(user, games));
  });

  app.post("/web/profile", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const { username, display_name, bio, accent_color, accent_color_hex, custom_css, show_recent_activity, show_library, profile_sections_order } = req.body ?? {};
    const accent = (/^#[0-9a-fA-F]{6}$/.test(accent_color_hex ?? "") ? accent_color_hex
      : /^#[0-9a-fA-F]{6}$/.test(accent_color ?? "") ? accent_color : null);
    const newUsername = (username ?? "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32) || user.username;
    if (newUsername !== user.username) {
      const taken = db.prepare("SELECT id FROM users WHERE username = ? AND id != ?").get(newUsername, user.id);
      if (taken) {
        const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
        return reply.type("text/html").send(dashboardPage(user, games, "Username already taken.", "err"));
      }
    }
    db.prepare("UPDATE users SET username = ?, display_name = ?, bio = ?, accent_color = ?, custom_css = ?, show_recent_activity = ?, show_library = ?, profile_sections_order = ? WHERE id = ?")
      .run(newUsername, (display_name ?? "").slice(0, 64), (bio ?? "").slice(0, 200), accent, (custom_css ?? "").slice(0, 8000), show_recent_activity === "1" ? 1 : 0, show_library === "1" ? 1 : 0, JSON.stringify(parseSectionsOrder(profile_sections_order ?? null)), user.id);
    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as DbUser;
    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
    return reply.type("text/html").send(dashboardPage(updated, games, "Profile updated.", "ok"));
  });

  app.post("/web/steam", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const { steam_id, steam_api_key } = req.body ?? {};

    const newKey = steam_api_key && !steam_api_key.startsWith("•") ? steam_api_key : user.steam_api_key;
    db.prepare("UPDATE users SET steam_id = ?, steam_api_key = ? WHERE id = ?")
      .run(steam_id || null, newKey || null, user.id);

    await syncSteamGames(user.id).catch(() => {});

    const updated = db.prepare("SELECT * FROM users WHERE id = ?").get(user.id) as DbUser;
    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
    return reply.type("text/html").send(dashboardPage(updated, games, "Steam synced.", "ok"));
  });

  app.post("/web/password", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const { current_password, new_password } = req.body ?? {};
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(user.id) as { password_hash: string };
    if (!verifyPassword(current_password ?? "", row.password_hash)) {
      const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
      return reply.type("text/html").send(dashboardPage(user, games, "Current password is incorrect.", "err"));
    }
    if (!new_password || new_password.length < 6) {
      const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
      return reply.type("text/html").send(dashboardPage(user, games, "New password must be at least 6 characters.", "err"));
    }
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(new_password), user.id);
    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
    return reply.type("text/html").send(dashboardPage(user, games, "Password changed.", "ok"));
  });

  app.post("/web/favorite", { config: { rawBody: true } }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const { shop, object_id } = req.body ?? {};
    if (shop && object_id) db.prepare("UPDATE games SET is_favorite = 1 WHERE user_id = ? AND object_id = ? AND shop = ?").run(user.id, object_id, shop);
    return reply.redirect("/web/dashboard");
  });

  app.post("/web/unfavorite", { config: { rawBody: true } }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const { shop, object_id } = req.body ?? {};
    if (shop && object_id) db.prepare("UPDATE games SET is_favorite = 0 WHERE user_id = ? AND object_id = ? AND shop = ?").run(user.id, object_id, shop);
    return reply.redirect("/web/dashboard");
  });

  app.post("/web/pin", { config: { rawBody: true } }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const { shop, object_id } = req.body ?? {};
    if (shop && object_id) {
      const now = Math.floor(Date.now() / 1000);
      db.prepare("UPDATE games SET is_pinned = 1, pinned_at = ? WHERE user_id = ? AND object_id = ? AND shop = ?").run(now, user.id, object_id, shop);
    }
    return reply.redirect("/web/dashboard");
  });

  app.post("/web/unpin", { config: { rawBody: true } }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const { shop, object_id } = req.body ?? {};
    if (shop && object_id) {
      db.prepare("UPDATE games SET is_pinned = 0, pinned_at = NULL WHERE user_id = ? AND object_id = ? AND shop = ?").run(user.id, object_id, shop);
    }
    return reply.redirect("/web/dashboard");
  });

  app.post("/web/upload-avatar", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const data = await (req as any).file();
    if (!data) return reply.redirect("/web/dashboard");
    const ext = (data.mimetype as string).split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const filename = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(IMAGES_DIR, filename), await data.toBuffer());
    db.prepare("UPDATE users SET profile_image_url = ? WHERE id = ?").run(`/images/${filename}`, user.id);
    return reply.redirect("/web/dashboard");
  });

  app.post("/web/upload-banner", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    const data = await (req as any).file();
    if (!data) return reply.redirect("/web/dashboard");
    const ext = (data.mimetype as string).split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
    const filename = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(IMAGES_DIR, filename), await data.toBuffer());
    db.prepare("UPDATE users SET background_image_url = ? WHERE id = ?").run(`/images/${filename}`, user.id);
    return reply.redirect("/web/dashboard");
  });

  app.post("/web/remove-banner", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.code(401).send();
    db.prepare("UPDATE users SET background_image_url = NULL WHERE id = ?").run(user.id);
    return reply.send({ ok: true });
  });

  app.get("/web/logout", async (_req: FastifyRequest, reply: FastifyReply) => {
    return reply.clearCookie("web_token", { path: "/" }).redirect("/");
  });

  app.get("/u/:username", async (
    req: FastifyRequest<{ Params: { username: string }; Querystring: { format?: string } }>,
    reply: FastifyReply
  ) => {
    const user = db.prepare("SELECT * FROM users WHERE username = ?")
      .get(req.params.username) as DbUser | undefined;
    if (!user) return reply.code(404).type("text/plain").send("User not found\n");

    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0")
      .all(user.id) as DbGame[];

    if (req.query.format === "json") {
      const totalSeconds = games.reduce((s, g) => s + g.play_time_in_seconds, 0);
      return reply.send({
        username: user.username,
        displayName: user.display_name,
        bio: user.bio,
        steamId: user.steam_id ?? undefined,
        games: games.length,
        totalHours: Math.floor(totalSeconds / 3600),
      });
    }

    const currentGame = await resolveCurrentGame(user, user.id);
    return reply.type("text/html").send(publicProfilePage(user, games, currentGame));
  });

  // Global accent color form handler (admin only)
  app.post("/web/global-accent", {
    config: { rawBody: true },
  }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.redirect("/");
    // Check admin
    let isAdmin = false;
    try {
      const roles = JSON.parse((user as any).roles || "[]");
      isAdmin = Array.isArray(roles) && roles.includes("admin");
    } catch {}
    if (!isAdmin) {
      const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
      return reply.type("text/html").send(dashboardPage(user, games, "Admin role required.", "err"));
    }
    const color = req.body?.color_hex || req.body?.color;
    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('global_accent_color', ?)").run(color);
    }
    const games = db.prepare("SELECT * FROM games WHERE user_id = ? AND is_deleted = 0").all(user.id) as DbGame[];
    return reply.type("text/html").send(dashboardPage(user, games, "Global accent color updated.", "ok"));
  });

  // Passkey web routes (cookie auth — call logic directly, no self-fetch)
  app.post("/web/passkeys/register/options", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    try {
      const existingPasskeys = db.prepare("SELECT credential_id FROM passkeys WHERE user_id = ?").all(user.id) as { credential_id: string }[];
      const options = await generateRegistrationOptions({
        rpName: RP_NAME,
        rpID: RP_ID,
        userName: user.username,
        attestationType: "none",
        excludeCredentials: existingPasskeys.map(pk => ({
          id: pk.credential_id,
          transports: ["internal"] as AuthenticatorTransportFuture[],
        })),
        authenticatorSelection: {
          residentKey: "preferred",
          userVerification: "preferred",
        },
      });
      (req as any).server.passkeyChallenge = options.challenge;
      (req as any).server.passkeyUserId = user.id;
      return options;
    } catch (err: any) {
      return reply.code(400).send({ error: err.message ?? "failed to generate options" });
    }
  });

  app.post("/web/passkeys/register/verify", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const challenge = (req as any).server.passkeyChallenge;
    if (!challenge) return reply.code(400).send({ error: "no challenge — start registration first" });
    const body = req.body as Record<string, any>;
    const label = body.label as string | undefined;
    const registrationResponse = body as RegistrationResponseJSON;
    try {
      const verification = await verifyRegistrationResponse({
        response: registrationResponse,
        expectedChallenge: challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      });
      if (!verification.verified || !verification.registrationInfo) {
        return reply.code(400).send({ error: "verification failed" });
      }
      const regInfo = verification.registrationInfo;
      const id = crypto.randomUUID();
      db.prepare(
        "INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, label) VALUES (?, ?, ?, ?, ?, ?, ?)"
      ).run(
        id, user.id, regInfo.credentialID,
        Buffer.from(regInfo.credentialPublicKey).toString("base64"),
        regInfo.counter,
        JSON.stringify(registrationResponse.response?.transports ?? []),
        label ?? `${regInfo.credentialDeviceType}${regInfo.credentialBackedUp ? " (backed up)" : ""}`
      );
      (req as any).server.passkeyChallenge = null;
      return { verified: true, passkeyId: id };
    } catch (err: any) {
      return reply.code(400).send({ error: err.message ?? "verification failed" });
    }
  });

  app.get("/web/passkeys/list", async (req: FastifyRequest, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const passkeys = db.prepare("SELECT id, label, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC").all(user.id) as { id: string; label: string; created_at: number }[];
    return passkeys.map(pk => ({
      id: pk.id,
      label: pk.label,
      createdAt: new Date(pk.created_at * 1000).toISOString(),
    }));
  });

  app.delete("/web/passkeys/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const user = getUserFromCookie(req);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    const pk = db.prepare("SELECT id FROM passkeys WHERE id = ? AND user_id = ?").get(req.params.id, user.id);
    if (!pk) return reply.code(404).send({ error: "not found" });
    db.prepare("DELETE FROM passkeys WHERE id = ?").run(req.params.id);
    return { ok: true };
  });

  // ─── ADMIN ────────────────────────────────────────────────────────────

  function checkAdmin(req: FastifyRequest): DbUser | null {
    const user = getUserFromCookie(req);
    if (!user) return null;
    try {
      const roles = JSON.parse(user.roles || "[]");
      if (!Array.isArray(roles) || !roles.includes("admin")) return null;
    } catch { return null; }
    return user;
  }

  function adminPage(adminUser: DbUser, msg?: string, msgType: "ok"|"err" = "ok") {
    const accent = getGlobalAccent();

    const users = db.prepare(`
      SELECT u.id, u.username, u.display_name, u.roles, u.is_banned, u.created_at,
        (SELECT COUNT(*) FROM games WHERE user_id = u.id AND is_deleted = 0) as game_count,
        (SELECT SUM(play_time_in_seconds) FROM games WHERE user_id = u.id AND is_deleted = 0) as total_play
      FROM users u ORDER BY u.created_at DESC
    `).all() as any[];

    const totalGames = (db.prepare("SELECT COUNT(*) as c FROM games WHERE is_deleted = 0").get() as any).c;
    const totalPlaytime = (db.prepare("SELECT SUM(play_time_in_seconds) as s FROM games WHERE is_deleted = 0").get() as any).s ?? 0;
    const totalAchievements = (db.prepare("SELECT COUNT(*) as c FROM achievements").get() as any).c;
    const globalAccent = (db.prepare("SELECT value FROM settings WHERE key = 'global_accent_color'").get() as { value: string } | undefined)?.value ?? "#d4a574";

    const fmtH = (s: number) => { const h = Math.floor((s ?? 0) / 3600); return h >= 1000 ? h.toLocaleString() + "h" : h + "h"; };

    return page("Admin", `
      <nav class="nav"><div class="nav-inner">
        <a href="/web/dashboard" class="nav-logo">Hydra</a>
        <div class="nav-links">
          <a href="/web/dashboard">Dashboard</a>
          <a href="/web/admin" class="active">Admin</a>
        </div>
        <div class="nav-controls">
          <a href="/web/logout" class="btn-icon" style="text-decoration:none">Sign out</a>
        </div>
      </div></nav>
      <div class="wrap">
      <div class="card wide" style="padding:0;overflow:hidden">
        <div style="padding:16px 24px 24px">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
            <div>
              <h1>Admin Panel</h1>
              <h2>Manage users, settings, and server</h2>
            </div>
            <a href="/web/dashboard" style="font-size:0.75rem;color:var(--text-1)">← Back to dashboard</a>
          </div>

          ${msg ? `<div class="${msgType}">${h(msg)}</div>` : ""}

          <h3>Server stats</h3>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
            <div style="background:var(--bg-2);padding:12px;text-align:center">
              <div style="font-size:20px;font-weight:600;color:var(--accent)">${users.length}</div>
              <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em">Users</div>
            </div>
            <div style="background:var(--bg-2);padding:12px;text-align:center">
              <div style="font-size:20px;font-weight:600;color:var(--accent)">${totalGames}</div>
              <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em">Games</div>
            </div>
            <div style="background:var(--bg-2);padding:12px;text-align:center">
              <div style="font-size:20px;font-weight:600;color:var(--accent)">${fmtH(totalPlaytime)}</div>
              <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em">Total playtime</div>
            </div>
            <div style="background:var(--bg-2);padding:12px;text-align:center">
              <div style="font-size:20px;font-weight:600;color:var(--accent)">${totalAchievements}</div>
              <div style="font-size:11px;color:var(--text-2);text-transform:uppercase;letter-spacing:0.05em">Achievements</div>
            </div>
          </div>

          <h3>Global accent color</h3>
          <form method="POST" action="/web/admin/global-accent" style="margin-bottom:24px">
            <div style="display:flex;gap:8px;align-items:center">
              <input type="color" name="color" id="admin-accent-picker" value="${h(globalAccent)}" style="width:40px;height:32px;padding:2px;cursor:pointer;border-radius:0" oninput="document.getElementById('admin-accent-hex').value=this.value">
              <input name="color_hex" id="admin-accent-hex" value="${h(globalAccent)}" maxlength="7" style="flex:1" placeholder="#d4a574" oninput="if(/^#[0-9a-fA-F]{6}$/.test(this.value))document.getElementById('admin-accent-picker').value=this.value">
              <button type="submit" style="width:auto;padding:8px 16px">Save</button>
            </div>
          </form>

          <h3>Create user</h3>
          <form method="POST" action="/web/admin/user/create" style="margin-bottom:24px">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div class="field">
                <label>Username</label>
                <input name="username" required maxlength="32" placeholder="username" style="font-family:var(--font-mono)">
              </div>
              <div class="field">
                <label>Display name</label>
                <input name="display_name" maxlength="64" placeholder="Optional">
              </div>
              <div class="field">
                <label>Password</label>
                <input name="password" type="password" required minlength="4" placeholder="••••••••">
              </div>
              <div class="field">
                <label>Admin?</label>
                <div style="display:flex;align-items:center;gap:6px;height:32px">
                  <input type="checkbox" name="is_admin" value="1" style="width:auto">
                  <span style="font-size:12px;color:var(--text-2)">grant admin role</span>
                </div>
              </div>
            </div>
            <button type="submit" style="width:auto;padding:8px 16px">Create user</button>
          </form>

          <h3>Users (${users.length})</h3>
          <div style="overflow-x:auto">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Games</th>
                  <th>Playtime</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th>Joined</th>
                  <th style="text-align:right">Actions</th>
                </tr>
              </thead>
              <tbody>
                ${users.map(u => {
                  const roles = (() => { try { return JSON.parse(u.roles || "[]"); } catch { return []; } })();
                  const isAdminUser = Array.isArray(roles) && roles.includes("admin");
                  const joined = new Date(u.created_at * 1000).toLocaleDateString();
                  return `<tr style="opacity:${u.is_banned ? '0.4' : '1'}">
                    <td>
                      <div style="font-weight:500">${h(u.display_name || u.username)}</div>
                      <div style="font-size:11px;color:var(--text-2)">@${h(u.username)}</div>
                    </td>
                    <td>${u.game_count ?? 0}</td>
                    <td>${fmtH(u.total_play)}</td>
                    <td>${isAdminUser ? '<span class="tag">admin</span>' : '<span style="color:var(--text-2);font-size:12px">—</span>'}</td>
                    <td>${u.is_banned ? '<span style="color:var(--err);font-size:12px">banned</span>' : '<span style="color:var(--ok);font-size:12px">active</span>'}</td>
                    <td style="font-size:12px;color:var(--text-2)">${joined}</td>
                    <td style="text-align:right;white-space:nowrap">
                      ${u.id !== adminUser.id ? `
                        <form method="POST" action="/web/admin/user/role" style="display:inline;margin:0">
                          <input type="hidden" name="user_id" value="${u.id}">
                          <input type="hidden" name="action" value="${isAdminUser ? 'remove-admin' : 'make-admin'}">
                          <button type="submit" style="background:none;border:1px solid var(--border-1);border-radius:0;cursor:pointer;padding:2px 8px;font-size:11px;color:${isAdminUser ? 'var(--err)' : 'var(--accent)'};font-family:var(--font-mono);font-weight:500;width:auto">${isAdminUser ? 'Demote' : 'Admin'}</button>
                        </form>
                        <form method="POST" action="/web/admin/user/ban" style="display:inline;margin:0">
                          <input type="hidden" name="user_id" value="${u.id}">
                          <input type="hidden" name="action" value="${u.is_banned ? 'unban' : 'ban'}">
                          <button type="submit" style="background:none;border:1px solid var(--border-1);border-radius:0;cursor:pointer;padding:2px 8px;font-size:11px;color:${u.is_banned ? 'var(--ok)' : 'var(--err)'};font-family:var(--font-mono);font-weight:500;width:auto">${u.is_banned ? 'Unban' : 'Ban'}</button>
                        </form>
                        <form method="POST" action="/web/admin/user/delete" style="display:inline;margin:0" onsubmit="return confirm('Delete user ${h(u.username)}? All data will be lost.')">
                          <input type="hidden" name="user_id" value="${u.id}">
                          <button type="submit" style="background:none;border:1px solid var(--border-1);border-radius:0;cursor:pointer;padding:2px 8px;font-size:11px;color:var(--err);font-family:var(--font-mono);font-weight:500;width:auto">Delete</button>
                        </form>
                      ` : '<span style="font-size:11px;color:var(--text-2)">you</span>'}
                    </td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      </div>
    `, accent);
  }

  app.get("/web/admin", async (req: FastifyRequest, reply: FastifyReply) => {
    const admin = checkAdmin(req);
    if (!admin) return reply.redirect("/web/dashboard");
    return reply.type("text/html").send(adminPage(admin));
  });

  app.post("/web/admin/global-accent", { config: { rawBody: true } }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const admin = checkAdmin(req);
    if (!admin) return reply.redirect("/web/dashboard");
    const color = req.body?.color_hex || req.body?.color;
    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('global_accent_color', ?)").run(color);
    }
    return reply.type("text/html").send(adminPage(admin, "Global accent color updated.", "ok"));
  });

  app.post("/web/admin/user/create", { config: { rawBody: true } }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const admin = checkAdmin(req);
    if (!admin) return reply.redirect("/web/dashboard");
    const { username, display_name, password, is_admin } = req.body ?? {};

    const cleanUsername = (username ?? "").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 32);
    if (!cleanUsername) return reply.type("text/html").send(adminPage(admin, "Username is required.", "err"));
    if (!password || password.length < 4) return reply.type("text/html").send(adminPage(admin, "Password must be at least 4 characters.", "err"));

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(cleanUsername);
    if (existing) return reply.type("text/html").send(adminPage(admin, `Username ${cleanUsername} is already taken.`, "err"));

    const id = crypto.randomUUID();
    db.prepare("INSERT INTO users (id, username, password_hash, display_name, roles) VALUES (?,?,?,?,?)")
      .run(id, cleanUsername, hashPassword(password), (display_name ?? "").slice(0, 64) || cleanUsername, is_admin === "1" ? JSON.stringify(["admin"]) : JSON.stringify([]));

    return reply.type("text/html").send(adminPage(admin, `User ${cleanUsername} created.`, "ok"));
  });

  app.post("/web/admin/user/role", { config: { rawBody: true } }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const admin = checkAdmin(req);
    if (!admin) return reply.redirect("/web/dashboard");
    const { user_id, action } = req.body ?? {};
    if (!user_id) return reply.type("text/html").send(adminPage(admin, "Missing user_id.", "err"));

    const user = db.prepare("SELECT id, roles FROM users WHERE id = ?").get(user_id) as { id: string; roles: string | null } | undefined;
    if (!user) return reply.type("text/html").send(adminPage(admin, "User not found.", "err"));

    let roles: string[] = [];
    try { roles = JSON.parse(user.roles || "[]"); } catch {}

    if (action === "make-admin") {
      if (!roles.includes("admin")) roles.push("admin");
    } else if (action === "remove-admin") {
      roles = roles.filter(r => r !== "admin");
    }

    db.prepare("UPDATE users SET roles = ? WHERE id = ?").run(JSON.stringify(roles), user_id);
    return reply.type("text/html").send(adminPage(admin, `Role updated for user.`, "ok"));
  });

  app.post("/web/admin/user/ban", { config: { rawBody: true } }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const admin = checkAdmin(req);
    if (!admin) return reply.redirect("/web/dashboard");
    const { user_id, action } = req.body ?? {};
    if (!user_id) return reply.type("text/html").send(adminPage(admin, "Missing user_id.", "err"));
    if (user_id === admin.id) return reply.type("text/html").send(adminPage(admin, "Cannot ban yourself.", "err"));

    const banned = action === "ban" ? 1 : 0;
    db.prepare("UPDATE users SET is_banned = ? WHERE id = ?").run(banned, user_id);
    return reply.type("text/html").send(adminPage(admin, banned ? "User banned." : "User unbanned.", "ok"));
  });

  app.post("/web/admin/user/delete", { config: { rawBody: true } }, async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
    const admin = checkAdmin(req);
    if (!admin) return reply.redirect("/web/dashboard");
    const { user_id } = req.body ?? {};
    if (!user_id) return reply.type("text/html").send(adminPage(admin, "Missing user_id.", "err"));
    if (user_id === admin.id) return reply.type("text/html").send(adminPage(admin, "Cannot delete yourself.", "err"));

    const user = db.prepare("SELECT id FROM users WHERE id = ?").get(user_id);
    if (!user) return reply.type("text/html").send(adminPage(admin, "User not found.", "err"));

    // Delete all user data
    db.prepare("DELETE FROM games WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM achievements WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM artifacts WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM blocks WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM badges WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM notifications WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?").run(user_id, user_id);
    db.prepare("DELETE FROM passkeys WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM reviews WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM review_answers WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM review_votes WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM cs_snapshots WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM cs_pending WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM collections WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM users WHERE id = ?").run(user_id);

    return reply.type("text/html").send(adminPage(admin, "User deleted.", "ok"));
  });
}
