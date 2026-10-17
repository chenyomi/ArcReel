import { createHmac, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const secret = process.env.ADMIN_TOKEN_SECRET || randomBytes(32).toString("hex");
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function signToken() {
  const body = Buffer.from(JSON.stringify({ exp: Date.now() + WEEK })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function readUser(header) {
  const token = String(header || "").replace(/^Bearer\s+/i, "");
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = createHmac("sha256", secret).update(body).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expect);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function passwordOk(input) {
  const expect = process.env.ADMIN_PASSWORD || "";
  if (!expect) return false;
  const left = createHash("sha256").update(String(input)).digest();
  const right = createHash("sha256").update(expect).digest();
  return timingSafeEqual(left, right);
}
