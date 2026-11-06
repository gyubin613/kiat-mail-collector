import { timingSafeEqual } from "node:crypto";
import { encodeSession, loginBlocked, loginFailed, loginSucceeded, sessionCookie } from "@/lib/server/auth";
import { bad, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const pw = process.env.ADMIN_PASSWORD;
  if (!pw) return bad("관리자 비밀번호(ADMIN_PASSWORD)가 설정되지 않았습니다.", 503);
  if (loginBlocked("__admin")) return bad("비밀번호가 여러 번 틀려 10분 동안 로그인할 수 없습니다.", 429);
  const body = await readJson<{ password?: string }>(req);
  const a = Buffer.from(String(body?.password ?? ""));
  const b = Buffer.from(pw);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    loginFailed("__admin");
    return bad("비밀번호가 맞지 않습니다.", 401);
  }
  loginSucceeded("__admin");
  return Response.json({ role: "admin" }, { headers: { "Set-Cookie": sessionCookie(encodeSession({ role: "admin" }), req) } });
}
