// 배포 설정 점검: 빠진 설정이 있으면 로그인 화면에 알려 준다
import { getStore } from "./store";

export interface SetupProblem {
  key: string;
  message: string;
}

/** 여러 서버 실행본이 함께 도는 환경(Vercel 등)인지 */
export function multiInstance(): boolean {
  return !!(process.env.VERCEL || process.env.MULTI_INSTANCE);
}

export function setupProblems(): SetupProblem[] {
  const out: SetupProblem[] = [];
  if (!multiInstance()) return out;
  if (!process.env.SESSION_SECRET && !process.env.ADMIN_PASSWORD) {
    out.push({
      key: "SESSION_SECRET",
      message: "로그인 유지에 쓰는 SESSION_SECRET이 설정되지 않아, 로그인해도 바로 풀립니다.",
    });
  }
  if (getStore().kind === "memory") {
    out.push({
      key: "UPSTASH_REDIS_REST_URL",
      message: "저장소(Upstash Redis)가 연결되지 않아 실 목록과 접수 기록이 저장되지 않습니다.",
    });
  }
  return out;
}

export function setupErrorResponse(): Response | null {
  const p = setupProblems();
  if (!p.length) return null;
  return Response.json(
    { error: `배포 설정이 끝나지 않아 로그인할 수 없습니다. ${p.map((x) => x.message).join(" ")}`, setup: p },
    { status: 503 },
  );
}
