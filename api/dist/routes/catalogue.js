"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.catalogueRoutes = catalogueRoutes;
const axios_1 = __importDefault(require("axios"));
const HYDRA_API = "https://hydra-api-us-east-1.losbroxas.org";
async function catalogueRoutes(app) {
    app.get("/games/:shop/:objectId/how-long-to-beat", async (req, reply) => {
        const { shop, objectId } = req.params;
        const res = await axios_1.default.get(`${HYDRA_API}/games/${shop}/${objectId}/how-long-to-beat`, {
            timeout: 10000,
        }).catch(() => null);
        if (!res?.data)
            return reply.code(404).send({ error: "not found" });
        return res.data;
    });
    app.get("/games/:shop/:objectId/protondb", async (req, reply) => {
        const { objectId } = req.params;
        const res = await axios_1.default.get(`https://www.protondb.com/api/v1/reports/summaries/${objectId}.json`, { timeout: 8000 }).catch(() => null);
        if (!res?.data)
            return reply.code(404).send({ error: "not found" });
        return res.data;
    });
}
