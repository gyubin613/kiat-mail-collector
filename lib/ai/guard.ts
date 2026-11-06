// AI 호출·메일 발송은 로그인한 실 담당자만 쓸 수 있다
import { requireMember } from "../server/auth";

export function checkAccess(req: Request): Response | null {
  const r = requireMember(req);
  return "error" in r ? r.error : null;
}
