import { COOKIE, encodeSession } from "../lib/server/auth";

/** 테스트용 로그인 쿠키 헤더 */
export function memberCookie(dept = "DEMO", user = "테스터"): Record<string, string> {
  return { cookie: `${COOKIE}=${encodeURIComponent(encodeSession({ role: "member", dept, user }))}` };
}

export function adminCookie(): Record<string, string> {
  return { cookie: `${COOKIE}=${encodeURIComponent(encodeSession({ role: "admin" }))}` };
}
