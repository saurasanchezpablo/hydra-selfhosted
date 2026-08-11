import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import { db } from "../db";
import { signAccess, verifyToken } from "../auth";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorDevice,
} from "@simplewebauthn/types";

const RP_NAME = "Hydra Self-Hosted";
const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? `http://localhost:${process.env.PORT ?? "3000"}`;

interface DbPasskey {
  id: string;
  user_id: string;
  credential_id: string;
  public_key: string;
  counter: number;
  transports: string;
  label: string;
  created_at: number;
}

function requireAuthMiddleware(req: FastifyRequest, reply: FastifyReply) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthorized" });
  try {
    (req as any).userId = verifyToken(auth.slice(7), "access");
  } catch {
    return reply.code(401).send({ error: "invalid token" });
  }
}

export async function passkeyRoutes(app: FastifyInstance) {
  // Register options
  app.post(
    "/passkeys/register/options",
    { preHandler: requireAuthMiddleware },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req as any).userId;
      const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId) as { id: string; username: string } | undefined;
      if (!user) return reply.code(404).send({ error: "user not found" });

      const existingPasskeys = db.prepare("SELECT credential_id FROM passkeys WHERE user_id = ?").all(userId) as { credential_id: string }[];

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
      (req as any).server.passkeyUserId = userId;

      return options;
    }
  );

  // Register verify
  app.post(
    "/passkeys/register/verify",
    { preHandler: requireAuthMiddleware },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const userId = (req as any).userId;
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
          id,
          userId,
          regInfo.credentialID,
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
    }
  );

  // Login options (public — no auth needed)
  app.post(
    "/passkeys/login/options",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = req.body as Record<string, any> | undefined;
      const username = body?.username as string | undefined;
      let allowCredentials: { id: string; transports: AuthenticatorTransportFuture[] }[] = [];

      if (username) {
        const user = db.prepare("SELECT id FROM users WHERE username = ?").get(username) as { id: string } | undefined;
        if (user) {
          const passkeys = db.prepare("SELECT credential_id, transports FROM passkeys WHERE user_id = ?").all(user.id) as DbPasskey[];
          allowCredentials = passkeys.map(pk => ({
            id: pk.credential_id,
            transports: JSON.parse(pk.transports) as AuthenticatorTransportFuture[],
          }));
        }
      }

      const options = await generateAuthenticationOptions({
        rpID: RP_ID,
        allowCredentials,
        userVerification: "preferred",
      });

      (req as any).server.passkeyLoginChallenge = options.challenge;

      return options;
    }
  );

  // Login verify (public)
  app.post(
    "/passkeys/login/verify",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const challenge = (req as any).server.passkeyLoginChallenge;
      if (!challenge) return reply.code(400).send({ error: "no challenge — start login first" });

      const body = req.body as Record<string, any>;
      const credentialId = body.id as string;
      const passkeyResponse = body as AuthenticationResponseJSON;

      const passkey = db.prepare("SELECT * FROM passkeys WHERE credential_id = ?").get(credentialId) as DbPasskey | undefined;
      if (!passkey) return reply.code(401).send({ error: "passkey not found" });

      try {
        const authenticator: AuthenticatorDevice = {
          credentialID: passkey.credential_id,
          credentialPublicKey: Buffer.from(passkey.public_key, "base64"),
          counter: passkey.counter,
          transports: JSON.parse(passkey.transports) as AuthenticatorTransportFuture[],
        };

        const verification = await verifyAuthenticationResponse({
          response: passkeyResponse,
          expectedChallenge: challenge,
          expectedOrigin: ORIGIN,
          expectedRPID: RP_ID,
          authenticator,
        });

        if (!verification.verified) {
          return reply.code(401).send({ error: "verification failed" });
        }

        db.prepare("UPDATE passkeys SET counter = ? WHERE id = ?").run(verification.authenticationInfo.newCounter, passkey.id);

        (req as any).server.passkeyLoginChallenge = null;

        const accessToken = signAccess(passkey.user_id);
        return { accessToken, expiresIn: parseInt(process.env.SESSION_TTL_DAYS ?? "30", 10) * 60 * 60 * 24 };
      } catch (err: any) {
        return reply.code(400).send({ error: err.message ?? "verification failed" });
      }
    }
  );

  // List passkeys (auth required)
  app.get(
    "/passkeys",
    { preHandler: requireAuthMiddleware },
    async (req: FastifyRequest) => {
      const userId = (req as any).userId;
      const passkeys = db.prepare("SELECT id, label, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC").all(userId) as { id: string; label: string; created_at: number }[];
      return passkeys.map(pk => ({
        id: pk.id,
        label: pk.label,
        createdAt: new Date(pk.created_at * 1000).toISOString(),
      }));
    }
  );

  // Delete a passkey (auth required)
  app.delete(
    "/passkeys/:id",
    { preHandler: requireAuthMiddleware },
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const userId = (req as any).userId;
      const pk = db.prepare("SELECT id FROM passkeys WHERE id = ? AND user_id = ?").get(req.params.id, userId);
      if (!pk) return reply.code(404).send({ error: "not found" });
      db.prepare("DELETE FROM passkeys WHERE id = ?").run(req.params.id);
      return { ok: true };
    }
  );
}
