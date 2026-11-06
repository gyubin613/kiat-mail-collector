// 로그인 세션 (서버 전용). 쿠키에 서명된 세션 정보를 담는다.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export interface Session {
  role: "member" | "admin";
  /** 실 코드 (member) */
  dept?: string;
  /** 담당자 이름 (member) */
  user?: string;
  exp: number;
}

export const COOKIE = "kmc_session";
const TTL_MS = 12 * 3600 * 1000;

const g = globalThis as unknown as { __kmcSecret?: string };
function secret(): string {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.ADMIN_PASSWORD) return `derived:${process.env.ADMIN_PASSWORD}`;
  // 시연(메모리 저장소)용: 서버를 다시 켜면 다시 로그인해야 한다
  g.__kmcSecret ||= randomBytes(32).toString("hex");
  return g.__kmcSecret;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const sign = (data: string) => createHmac("sha256", secret()).update(data).digest("base64url");

export function encodeSession(s: Omit<Session, "exp">, now = Date.now()): string {
  const data = b64(JSON.stringify({ ...s, exp: now + TTL_MS }));
  return `${data}.${sign(data)}`;
}

export function decodeSession(token: string | undefined, now = Date.now()): Session | null {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;
  const expected = sign(data);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const s = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as Session;
    if (!s.exp || s.exp < now) return null;
    return s;
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name = COOKIE): string | undefined {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return undefined;
}

export function getSession(req: Request): Session | null {
  return decodeSession(readCookie(req));
}

export function sessionCookie(token: string, req: Request): string {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}${secure}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function requireMember(req: Request): { session: Session & { dept: string; user: string } } | { error: Response } {
  const s = getSession(req);
  if (!s || s.role !== "member" || !s.dept) {
    return { error: Response.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  }
  return { session: { ...s, dept: s.dept, user: s.user || "담당자" } };
}

export function requireAdmin(req: Request): { session: Session } | { error: Response } {
  const s = getSession(req);
  if (!s || s.role !== "admin") return { error: Response.json({ error: "관리자 로그인이 필요합니다." }, { status: 401 }) };
  return { session: s };
}

export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 32).toString("hex")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [salt, hash] = (stored || "").split(":");
  if (!salt || !hash) return false;
  const got = scryptSync(pw, salt, 32);
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

// 로그인 실패가 이어지면 잠시 막는다 (실별, 메모리 기준)
const fails = new Map<string, { n: number; until: number }>();
export function loginBlocked(key: string, now = Date.now()): boolean {
  const f = fails.get(key);
  return !!f && f.until > now;
}
export function loginFailed(key: string, now = Date.now()) {
  const f = fails.get(key) ?? { n: 0, until: 0 };
  f.n += 1;
  if (f.n >= 8) {
    f.until = now + 10 * 60 * 1000;
    f.n = 0;
  }
  fails.set(key, f);
}
export function loginSucceeded(key: string) {
  fails.delete(key);
}
