import crypto from "node:crypto";

export function hashPassword(password: string, salt?: string) {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, useSalt, 64).toString("hex");
  return { hash, salt: useSalt };
}

export function verifyPassword(password: string, salt: string, hash: string) {
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(check, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getSecret(): string {
  // @ts-ignore - Netlify global có sẵn trong môi trường function
  return (typeof Netlify !== "undefined" ? Netlify.env.get("AUTH_SECRET") : null) || "dev-insecure-secret";
}

export function signToken(payload: Record<string, any>, expiresInSec = 7 * 24 * 3600) {
  const body = { ...payload, exp: Date.now() + expiresInSec * 1000 };
  const json = JSON.stringify(body);
  const b64 = Buffer.from(json).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(b64).digest("base64url");
  return `${b64}.${sig}`;
}

export function verifyToken(token: string | null): any | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = crypto.createHmac("sha256", getSecret()).update(b64).digest("base64url");
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function getBearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

export function cryptoId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function jsonResponse(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
