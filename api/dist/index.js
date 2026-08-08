"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cookie_1 = __importDefault(require("@fastify/cookie"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const auth_1 = require("./routes/auth");
const profile_1 = require("./routes/profile");
const games_1 = require("./routes/games");
const artifacts_1 = require("./routes/artifacts");
const cloud_saves_1 = require("./routes/cloud-saves");
const images_1 = require("./routes/images");
const web_1 = require("./routes/web");
const friends_1 = require("./routes/friends");
const catalogue_1 = require("./routes/catalogue");
const reviews_1 = require("./routes/reviews");
const steam_sync_1 = require("./steam-sync");
const maxSaveSizeMb = Number(process.env.MAX_SAVE_SIZE_MB) || 50;
const maxSaveSizeBytes = maxSaveSizeMb * 1024 * 1024;
const app = (0, fastify_1.default)({ logger: true, bodyLimit: maxSaveSizeBytes });
app.register(cookie_1.default);
app.register(multipart_1.default, { limits: { fileSize: maxSaveSizeBytes } });
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
app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => {
    const params = new URLSearchParams(body);
    const result = {};
    for (const [k, v] of params)
        result[k] = v;
    done(null, result);
});
app.register(auth_1.authRoutes);
app.register(profile_1.profileRoutes);
app.register(games_1.gamesRoutes);
app.register(artifacts_1.artifactsRoutes);
app.register(cloud_saves_1.cloudSavesRoutes);
app.register(images_1.imagesRoutes);
app.register(web_1.webRoutes);
app.register(friends_1.friendsRoutes);
app.register(catalogue_1.catalogueRoutes);
app.register(reviews_1.reviewsRoutes);
app.get("/health", async () => ({ status: "ok" }));
const port = parseInt(process.env.PORT ?? "3000", 10);
app.listen({ port, host: "0.0.0.0" }).then(() => {
    (0, steam_sync_1.startSteamSyncScheduler)();
}).catch((err) => {
    app.log.error(err);
    process.exit(1);
});
