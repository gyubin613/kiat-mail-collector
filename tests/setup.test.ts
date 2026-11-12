import { afterEach, describe, expect, it } from "vitest";
import { GET as depts } from "../app/api/auth/depts/route";
import { POST as login } from "../app/api/auth/login/route";
import { decodeSession, encodeSession } from "../lib/server/auth";
import { setupProblems } from "../lib/server/setup";
import { resetStoreForTest } from "../lib/server/store";

const loginReq = () =>
  new Request("https://x/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dept: "DEMO", user: "점검" }) });

afterEach(() => {
  for (const k of ["VERCEL", "SESSION_SECRET", "ADMIN_PASSWORD"]) delete process.env[k];
  resetStoreForTest();
});

describe("배포 설정 점검", () => {
  it("Vercel에서 SESSION_SECRET·저장소가 없으면 로그인 대신 무엇이 빠졌는지 알려준다", async () => {
    process.env.VERCEL = "1";
    const res = await login(loginReq());
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("SESSION_SECRET");
    expect(body.setup.map((p: { key: string }) => p.key)).toEqual(["SESSION_SECRET", "UPSTASH_REDIS_REST_URL"]);
    expect(res.headers.get("set-cookie")).toBeNull();
    const d = await (await depts()).json();
    expect(d.setup).toHaveLength(2);
  });

  it("SESSION_SECRET이 있으면 서버 실행본이 달라도 로그인이 유지된다", () => {
    process.env.SESSION_SECRET = "long-random-secret-for-test";
    const token = encodeSession({ role: "member", dept: "DEMO", user: "x" });
    (globalThis as { __kmcSecret?: string }).__kmcSecret = "other-instance-random";
    expect(decodeSession(token)?.dept).toBe("DEMO");
  });

  it("내 컴퓨터(서버 하나)에서는 설정 없이도 시연할 수 있다", async () => {
    expect(setupProblems()).toEqual([]);
    expect((await login(loginReq())).status).toBe(200);
  });
});
