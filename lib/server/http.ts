import { requireMember } from "./auth";
import { getDept, type Dept } from "./depts";

export async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export const bad = (msg: string, status = 400) => Response.json({ error: msg }, { status });

/** 로그인한 실 담당자만. 실이 삭제됐으면 거절 */
export async function member(req: Request): Promise<{ dept: Dept; user: string } | Response> {
  const r = requireMember(req);
  if ("error" in r) return r.error;
  const dept = await getDept(r.session.dept);
  if (!dept) return bad("실 정보를 찾을 수 없습니다. 다시 로그인해 주세요.", 401);
  return { dept, user: r.session.user };
}
