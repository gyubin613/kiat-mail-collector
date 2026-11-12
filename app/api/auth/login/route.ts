import { encodeSession, loginBlocked, loginFailed, loginSucceeded, sessionCookie, verifyPassword } from "@/lib/server/auth";
import { getDept, publicDept } from "@/lib/server/depts";
import { bad, readJson } from "@/lib/server/http";
import { setupErrorResponse } from "@/lib/server/setup";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const notReady = setupErrorResponse();
  if (notReady) return notReady;
  const body = await readJson<{ dept?: string; password?: string; user?: string }>(req);
  const code = String(body?.dept ?? "").trim().toUpperCase();
  const user = String(body?.user ?? "").replace(/[\r\n]/g, "").trim().slice(0, 40);
  if (!code) return bad("실을 골라 주세요.");
  if (!user) return bad("담당자 이름을 입력해 주세요. 작업 기록에 남습니다.");
  if (loginBlocked(code)) return bad("비밀번호가 여러 번 틀려 10분 동안 로그인할 수 없습니다.", 429);
  const dept = await getDept(code);
  if (!dept) return bad("없는 실입니다.", 404);
  if (!dept.demo && !verifyPassword(String(body?.password ?? ""), dept.pwHash)) {
    loginFailed(code);
    return bad("비밀번호가 맞지 않습니다.", 401);
  }
  loginSucceeded(code);
  const token = encodeSession({ role: "member", dept: dept.code, user });
  return Response.json({ dept: publicDept(dept), user }, { headers: { "Set-Cookie": sessionCookie(token, req) } });
}
