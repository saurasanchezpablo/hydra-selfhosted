"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.passkeyRoutes = passkeyRoutes;
const node_crypto_1 = __importDefault(require("node:crypto"));
const db_1 = require("../db");
const auth_1 = require("../auth");
const server_1 = require("@simplewebauthn/server");
const RP_NAME = "Hydra Self-Hosted";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? `http://localhost:${process.env.PORT ?? "3000"}`;
function requireAuthMiddleware(req, reply) {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer "))
        return reply.code(401).send({ error: "unauthorized" });
    try {
        req.userId = (0, auth_1.verifyToken)(auth.slice(7), "access");
    }
    catch {
        return reply.code(401).send({ error: "invalid token" });
    }
}
async function passkeyRoutes(app) {
    // Register options
    app.post("/passkeys/register/options", { preHandler: requireAuthMiddleware }, async (req, reply) => {
        const userId = req.userId;
        const user = db_1.db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);
        if (!user)
            return reply.code(404).send({ error: "user not found" });
        const existingPasskeys = db_1.db.prepare("SELECT credential_id FROM passkeys WHERE user_id = ?").all(userId);
        const options = await (0, server_1.generateRegistrationOptions)({
            rpName: RP_NAME,
            rpID: RP_ID,
            userName: user.username,
            attestationType: "none",
            excludeCredentials: existingPasskeys.map(pk => ({
                id: pk.credential_id,
                transports: ["internal"],
            })),
            authenticatorSelection: {
                residentKey: "preferred",
                userVerification: "preferred",
            },
        });
        req.server.passkeyChallenge = options.challenge;
        req.server.passkeyUserId = userId;
        return options;
    });
    // Register verify
    app.post("/passkeys/register/verify", { preHandler: requireAuthMiddleware }, async (req, reply) => {
        const userId = req.userId;
        const challenge = req.server.passkeyChallenge;
        if (!challenge)
            return reply.code(400).send({ error: "no challenge — start registration first" });
        const body = req.body;
        const label = body.label;
        const registrationResponse = body;
        try {
            const verification = await (0, server_1.verifyRegistrationResponse)({
                response: registrationResponse,
                expectedChallenge: challenge,
                expectedOrigin: ORIGIN,
                expectedRPID: RP_ID,
            });
            if (!verification.verified || !verification.registrationInfo) {
                return reply.code(400).send({ error: "verification failed" });
            }
            const regInfo = verification.registrationInfo;
            const id = node_crypto_1.default.randomUUID();
            db_1.db.prepare("INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, label) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, userId, regInfo.credentialID, Buffer.from(regInfo.credentialPublicKey).toString("base64"), regInfo.counter, JSON.stringify(registrationResponse.response?.transports ?? []), label ?? `${regInfo.credentialDeviceType}${regInfo.credentialBackedUp ? " (backed up)" : ""}`);
            req.server.passkeyChallenge = null;
            return { verified: true, passkeyId: id };
        }
        catch (err) {
            return reply.code(400).send({ error: err.message ?? "verification failed" });
        }
    });
    // Login options (public — no auth needed)
    app.post("/passkeys/login/options", async (req, reply) => {
        const body = req.body;
        const username = body?.username;
        let allowCredentials = [];
        if (username) {
            const user = db_1.db.prepare("SELECT id FROM users WHERE username = ?").get(username);
            if (user) {
                const passkeys = db_1.db.prepare("SELECT credential_id, transports FROM passkeys WHERE user_id = ?").all(user.id);
                allowCredentials = passkeys.map(pk => ({
                    id: pk.credential_id,
                    transports: JSON.parse(pk.transports),
                }));
            }
        }
        const options = await (0, server_1.generateAuthenticationOptions)({
            rpID: RP_ID,
            allowCredentials,
            userVerification: "preferred",
        });
        req.server.passkeyLoginChallenge = options.challenge;
        return options;
    });
    // Login verify (public)
    app.post("/passkeys/login/verify", async (req, reply) => {
        const challenge = req.server.passkeyLoginChallenge;
        if (!challenge)
            return reply.code(400).send({ error: "no challenge — start login first" });
        const body = req.body;
        const credentialId = body.id;
        const passkeyResponse = body;
        const passkey = db_1.db.prepare("SELECT * FROM passkeys WHERE credential_id = ?").get(credentialId);
        if (!passkey)
            return reply.code(401).send({ error: "passkey not found" });
        try {
            const authenticator = {
                credentialID: passkey.credential_id,
                credentialPublicKey: Buffer.from(passkey.public_key, "base64"),
                counter: passkey.counter,
                transports: JSON.parse(passkey.transports),
            };
            const verification = await (0, server_1.verifyAuthenticationResponse)({
                response: passkeyResponse,
                expectedChallenge: challenge,
                expectedOrigin: ORIGIN,
                expectedRPID: RP_ID,
                authenticator,
            });
            if (!verification.verified) {
                return reply.code(401).send({ error: "verification failed" });
            }
            db_1.db.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").run(verification.authenticationInfo.newCounter, passkey.id);
            req.server.passkeyLoginChallenge = null;
            const accessToken = (0, auth_1.signAccess)(passkey.user_id);
            return { accessToken, expiresIn: parseInt(process.env.SESSION_TTL_DAYS ?? "30", 10) * 60 * 60 * 24 };
        }
        catch (err) {
            return reply.code(400).send({ error: err.message ?? "verification failed" });
        }
    });
    // List passkeys (auth required)
    app.get("/passkeys", { preHandler: requireAuthMiddleware }, async (req) => {
        const userId = req.userId;
        const passkeys = db_1.db.prepare("SELECT id, label, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC").all(userId);
        return passkeys.map(pk => ({
            id: pk.id,
            label: pk.label,
            createdAt: new Date(pk.created_at * 1000).toISOString(),
        }));
    });
    // Delete a passkey (auth required)
    app.delete("/passkeys/:id", { preHandler: requireAuthMiddleware }, async (req, reply) => {
        const userId = req.userId;
        const pk = db_1.db.prepare("SELECT id FROM passkeys WHERE id = ? AND user_id = ?").get(req.params.id, userId);
        if (!pk)
            return reply.code(404).send({ error: "not found" });
        db_1.db.prepare("DELETE FROM passkeys WHERE id = ?").run(req.params.id);
        return { ok: true };
    });
}
