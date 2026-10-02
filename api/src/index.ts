import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyMultipart from "@fastify/multipart";
import fastifyCors from "@fastify/cors";
import { authRoutes } from "./routes/auth";
import { profileRoutes } from "./routes/profile";
import { gamesRoutes } from "./routes/games";
import { artifactsRoutes } from "./routes/artifacts";
import { cloudSavesRoutes } from "./routes/cloud-saves";
import { imagesRoutes } from "./routes/images";
import { webRoutes } from "./routes/web";
import { friendsRoutes } from "./routes/friends";
import { catalogueRoutes } from "./routes/catalogue";
import { reviewsRoutes } from "./routes/reviews";
import { publicApiRoutes } from "./routes/public-api";
import { docsRoutes } from "./routes/docs";
import { passkeyRoutes } from "./routes/passkeys";
import { adminRoutes } from "./routes/admin";
import { achievementSouvenirRoutes } from "./routes/achievement-souvenirs";
import { startSteamSyncScheduler } from "./steam-sync";

const maxSaveSizeMb = Number(process.env.MAX_SAVE_SIZE_MB) || 50;
const maxSaveSizeBytes = maxSaveSizeMb * 1024 * 1024;

const app = Fastify({ logger: true, bodyLimit: maxSaveSizeBytes });

app.register(fastifyCookie);
app.register(fastifyMultipart, { limits: { fileSize: maxSaveSizeBytes } });
app.register(fastifyCors, {
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(",").map(s => s.trim()) : true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

app.addContentTypeParser("application/tar", { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser(/^image\//, { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser("*", { parseAs: "buffer" }, (_req, body, done) => {
  done(null, body);
});
app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body: string, done) => {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [k, v] of params) result[k] = v;
  done(null, result);
});

app.register(authRoutes);
app.register(profileRoutes);
app.register(gamesRoutes);
app.register(artifactsRoutes);
app.register(cloudSavesRoutes);
app.register(imagesRoutes);
app.register(webRoutes);
app.register(friendsRoutes);
app.register(catalogueRoutes);
app.register(reviewsRoutes);
app.register(publicApiRoutes);
app.register(docsRoutes);
app.register(passkeyRoutes);
app.register(adminRoutes);
app.register(achievementSouvenirRoutes);

app.get("/health", async () => ({ status: "ok" }));

const port = parseInt(process.env.PORT ?? "3000", 10);
app.listen({ port, host: "0.0.0.0" }).then(() => {
  startSteamSyncScheduler();
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
