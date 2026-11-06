import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as adminDepts, GET as listAdminDepts } from "../app/api/admin/depts/route";
import { POST as adminLogin } from "../app/api/auth/admin/route";
import { POST as login } from "../app/api/auth/login/route";
import { GET as getLedger } from "../app/api/ledger/route";
import { PATCH as patchMails, POST as postMails } from "../app/api/ledger/mails/route";
import { PUT as putProjects } from "../app/api/ledger/projects/route";
import { PUT as putSettings } from "../app/api/ledger/settings/route";
import { POST as transfer } from "../app/api/ledger/transfer/route";
import { computeVersions, daysLeft, ddayLabel, fromLedgerMail, initialKpass, toLedgerMail, type LedgerSnapshot } from "../lib/ledger";
import { parseAll } from "../lib/mail";
import { matchAll } from "../lib/matcher";
import { rowsToProjects } from "../lib/projects";
import { readSheet } from "../lib/readSheet";
import { cleanProjects } from "../lib/server/ledger";
import { resetStoreForTest } from "../lib/server/store";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { adminCookie, memberCookie } from "./helpers";

const S = join(__dirname, "..", "public", "samples");
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api", { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  resetStoreForTest();
  process.env.ADMIN_PASSWORD = "admin-pass-1234";
});

describe("로그인과 실 관리", () => {
  it("관리자가 실을 만들고, 그 실 비밀번호로 담당자가 로그인한다", async () => {
    expect((await adminLogin(req("POST", { password: "틀림" }))).status).toBe(401);
    const a = await adminLogin(req("POST", { password: "admin-pass-1234" }));
    expect(a.status).toBe(200);
    expect(a.headers.get("set-cookie")).toContain("kmc_session=");
    const made = await adminDepts(req("POST", { code: "intl", name: "국제협력전략실", password: "intl-pass-1" }, adminCookie()));
    expect((await made.json()).dept).toEqual({ code: "INTL", name: "국제협력전략실", demo: false });
    expect((await adminDepts(req("POST", { code: "X", name: "짧은코드", password: "12345678" }, adminCookie()))).status).toBe(400);
    expect((await listAdminDepts(req("GET", undefined, memberCookie()))).status).toBe(401);

    expect((await login(req("POST", { dept: "INTL", password: "nope", user: "김OO" }))).status).toBe(401);
    expect((await login(req("POST", { dept: "INTL", password: "intl-pass-1", user: "" }))).status).toBe(400);
    const ok = await login(req("POST", { dept: "INTL", password: "intl-pass-1", user: "김OO" }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toMatch(/HttpOnly/);
  });

  it("체험용 실은 비밀번호 없이 들어간다", async () => {
    expect((await login(req("POST", { dept: "DEMO", user: "체험" }))).status).toBe(200);
  });

  it("실마다 기록이 분리된다", async () => {
    await adminDepts(req("POST", { code: "INTL", name: "국제협력전략실", password: "intl-pass-1" }, adminCookie()));
    await adminDepts(req("POST", { code: "TECH", name: "기술사업실", password: "tech-pass-1" }, adminCookie()));
    await putProjects(req("PUT", { projects: [{ id: "P1", name: "가", institutions: [] }], sourceName: "a.xlsx" }, memberCookie("INTL")));
    const intl = (await (await getLedger(req("GET", undefined, memberCookie("INTL")))).json()) as LedgerSnapshot;
    const tech = (await (await getLedger(req("GET", undefined, memberCookie("TECH")))).json()) as LedgerSnapshot;
    expect(intl.projects?.projects).toHaveLength(1);
    expect(tech.projects).toBeNull();
    expect((await getLedger(req("GET"))).status).toBe(401);
  });
});

describe("누적 접수대장", () => {
  it("서버에서도 현황의 전화번호를 다시 거른다", () => {
    const p = cleanProjects([
      { id: "P1", name: "과제 (010-1111-2222)", institutions: [{ name: "가기관", role: "주관기관", contactName: "홍길동 02-123-4567", emails: ["a@b.example.kr", "not-an-email"], phone: "010-9999-9999" }] },
    ]);
    expect(JSON.stringify(p)).not.toMatch(/\d{3,4}-\d{4}/);
    expect(p[0].institutions[0].emails).toEqual(["a@b.example.kr"]);
    expect(JSON.stringify(p)).not.toContain("phone");
  });

  it("메일 기록: 원문 없이 저장하고, 같은 메일은 건너뛰고, 고친 내용을 남긴다", async () => {
    const projects = rowsToProjects(await readSheet(new Uint8Array(readFileSync(join(S, "과제관리현황_가상.xlsx"))), "x.xlsx")).projects;
    const { mails } = await parseAll([{ name: "m.zip", bytes: new Uint8Array(readFileSync(join(S, "가상메일.zip"))) }]);
    const results = matchAll(mails, projects, DEFAULT_SETTINGS);
    const ledger = mails.map((m, i) => toLedgerMail(m, results[i], "김OO", "upload"));
    const h = memberCookie("DEMO", "김OO");
    const first = await (await postMails(req("POST", { mails: ledger }, h))).json();
    expect(first.added).toHaveLength(45);
    const again = await (await postMails(req("POST", { mails: ledger.slice(0, 5) }, h))).json();
    expect(again).toMatchObject({ added: [], skipped: expect.any(Array) });
    expect(again.skipped).toHaveLength(5);

    const snap = (await (await getLedger(req("GET", undefined, h))).json()) as LedgerSnapshot;
    expect(snap.mails).toHaveLength(45);
    const raw = JSON.stringify(snap.mails);
    expect(raw).not.toContain("JVBERi0"); // PDF 내용(base64) 없음
    expect(raw).not.toContain('"raw"');
    expect(snap.events.filter((e) => e.type === "접수").length).toBeGreaterThan(30);

    const target = snap.mails.find((m) => m.sourceName === "unknown_scan.eml")!;
    await patchMails(req("PATCH", { updates: [{ key: target.key, result: { ...target.result, projectId: "P0031025", status: "confirmed", edited: true } }] }, h));
    const after = (await (await getLedger(req("GET", undefined, h))).json()) as LedgerSnapshot;
    expect(after.mails.find((m) => m.key === target.key)!.result).toMatchObject({ projectId: "P0031025", status: "confirmed" });

    // 기록만으로 화면 자료 복원
    const back = fromLedgerMail(after.mails[0]);
    expect(back.mail.stub).toBe(true);
    expect(back.mail.attachments[0].content.byteLength).toBe(0);
  });

  it("설정 저장: 제출 기한·K-PASS 기간·제출 주소 검증", async () => {
    const res = await putSettings(
      req("PUT", { ...DEFAULT_SETTINGS, deadlines: { 참여확약서: "2026-12-15", 협약서: "나중에" }, kpassWindow: { from: "2026-11-28", to: "2027-01-05" }, submitTo: "잘못된주소" }, memberCookie()),
    );
    const s = await res.json();
    expect(s.deadlines).toEqual({ 참여확약서: "2026-12-15" });
    expect(s.kpassWindow).toEqual({ from: "2026-11-28", to: "2027-01-05" });
    expect(s.submitTo).toBe("");
  });

  it("담당자 이관", async () => {
    const h = memberCookie("DEMO", "박OO");
    await putProjects(req("PUT", { projects: [{ id: "P1", name: "가", manager: "김OO" }, { id: "P2", name: "나", manager: "김OO" }, { id: "P3", name: "다", manager: "이OO" }] }, h));
    const doc = await (await transfer(req("POST", { from: "김OO", to: "최OO", projectIds: ["P1", "P2", "P3"] }, h))).json();
    expect(doc.projects.map((p: { manager: string }) => p.manager)).toEqual(["최OO", "최OO", "이OO"]);
    const snap = (await (await getLedger(req("GET", undefined, h))).json()) as LedgerSnapshot;
    const ev = snap.events.filter((e) => e.type === "담당자 변경");
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ by: "박OO", projectId: "P1", text: "담당자 변경: 김OO → 최OO" });
  });
});

describe("재제출·기한·K-PASS", () => {
  it("같은 기관·서류를 다시 내면 차수, 같은 파일이면 중복", async () => {
    const projects = rowsToProjects(await readSheet(new Uint8Array(readFileSync(join(S, "과제관리현황_가상.xlsx"))), "x.xlsx")).projects;
    const { mails } = await parseAll([{ name: "m.zip", bytes: new Uint8Array(readFileSync(join(S, "가상메일.zip"))) }]);
    const results = matchAll(mails, projects, DEFAULT_SETTINGS);
    const v = computeVersions(mails, results);
    const ref = (src: string, idx = 0) => `${mails.find((m) => m.sourceName === src)!.id}#${idx}`;
    expect(v.get(ref("P0031004_loc.eml"))).toMatchObject({ version: 1, total: 2, latest: false });
    expect(v.get(ref("P0031004_loc_resubmit.eml"))).toMatchObject({ version: 2, total: 2, latest: true });
    expect(v.get(ref("P0031005_loc_dup.eml"))!.duplicateOf).toBe(mails.find((m) => m.sourceName === "P0031005_loc.eml")!.id);
  });

  it("D-day 표기", () => {
    const now = new Date("2026-12-10T03:00:00Z");
    expect(ddayLabel(daysLeft("2026-12-15", now))).toBe("D-5");
    expect(ddayLabel(daysLeft("2026-12-10", now))).toBe("D-day");
    expect(ddayLabel(daysLeft("2026-12-08", now))).toBe("2일 지남");
    expect(daysLeft("", now)).toBeNull();
  });

  it("K-PASS 중단 기간에 받은 서류는 등록 대기", () => {
    const s = { ...DEFAULT_SETTINGS, kpassWindow: { from: "2026-11-28", to: "2027-01-05" } };
    expect(initialKpass("2026-12-01T01:00:00Z", s, "참여확약서")).toBe("등록 대기");
    expect(initialKpass("2026-11-20T01:00:00Z", s, "참여확약서")).toBe("해당 없음");
    expect(initialKpass("2026-12-01T01:00:00Z", s, "기타")).toBe("해당 없음");
  });
});
