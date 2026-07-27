"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACCESS_TTL = void 0;
exports.signAccess = signAccess;
exports.signRefresh = signRefresh;
exports.signWs = signWs;
exports.verifyToken = verifyToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.API_TOKEN ?? "change-me";
const ACCESS_TTL = parseInt(process.env.SESSION_TTL_DAYS ?? "30", 10) * 60 * 60 * 24;
exports.ACCESS_TTL = ACCESS_TTL;
const REFRESH_TTL = 60 * 60 * 24 * 30; // 30d
const WS_TTL = 60 * 5; // 5m
function signAccess(userId) {
    return jsonwebtoken_1.default.sign({ sub: userId, type: "access" }, JWT_SECRET, { expiresIn: ACCESS_TTL });
}
function signRefresh(userId) {
    return jsonwebtoken_1.default.sign({ sub: userId, type: "refresh" }, JWT_SECRET, { expiresIn: REFRESH_TTL });
}
function signWs(userId) {
    return jsonwebtoken_1.default.sign({ sub: userId, type: "ws" }, JWT_SECRET, { expiresIn: WS_TTL });
}
function verifyToken(token, type) {
    const payload = jsonwebtoken_1.default.verify(token, JWT_SECRET);
    if (payload.type !== type)
        throw new Error("wrong token type");
    return payload.sub;
}
