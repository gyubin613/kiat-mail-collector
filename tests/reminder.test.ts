import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as send } from "../app/api/mail/send/route";
import { parseAll } from "../lib/mail";
import { isAllowed, resetTransportForTest } from "../lib/mailer";
import { matchAll } from "../lib/matcher";
import { projectStatus, type InstitutionStatusRow } from "../lib/organize";
import { rowsToProjects } from "../lib/projects";
import { readSheet } from "../lib/readSheet";
import { buildDraft, deadlineEn, deadlineKo, logSummary, parseRecipients, type ReminderOptions } from "../lib/reminder";
import { DEFAULT_SETTINGS } from "../lib/settings";

const S = join(__dirname, "..", "public", "samples");
let rows: InstitutionStatusRow[];
const opts: ReminderOptions = { deadline: "2026-12-15", submitTo: "intl-docs@kiat-demo.example.kr", signature: "국제협력전략실 담당자 김OO", kpassClosed: true };

beforeAll(async () => {
  const projects = rowsToProjects(await readSheet(new Uint8Array(readFileSync(join(S, "과제관리현황_가상.xlsx"))), "x.xlsx")).projects;
  const { mails } = await parseAll([{ name: "m.zip", bytes: new Uint8Array(readFileSync(join(S, "가상메일.zip"))) }]);
  const results = matchAll(mails, projects, DEFAULT_SETTINGS);
  rows = projectStatus(mails, results, projects, DEFAULT_SETTINGS).flatMap((p) => p.institutions);
});
const row = (pid: string, role: "주관기관" | "참여기관") => rows.find((r) => r.project.id === pid && r.institution.role === role)!;

describe("독촉 메일 초안", () => {
  it("날짜 표기", () => {
    expect(deadlineKo("2026-12-15")).toBe("2026년 12월 15일(화)");
    expect(deadlineEn("2026-12-15")).toBe("Tuesday, 15 December 2026");
    expect(deadlineKo("")).toBe("별도 안내");
  });

  it("국내 주관기관은 국문, 과제 공통 서류까지 요청", () => {
    const d = buildDraft(row("P0031025", "주관기관"), opts);
    expect(d.lang).toBe("ko");
    expect(d.docs).toEqual(["재무증빙", "협약서"]);
    expect(d.subject).toBe("[KIAT] P0031025 과제 제출 서류 요청 (재무증빙, 협약서)");
    expect(d.body).toContain("2026년 12월 15일(화)");
    expect(d.body).toContain("intl-docs@kiat-demo.example.kr 로 메일 제출 (K-PASS 운영 중단 기간에는 메일로 받습니다)");
    expect(d.body).toContain("P0031025_");
    expect(d.to).toMatch(/@.+\.example\.kr$/);
  });

  it("해외 참여기관은 영문, 책임연구자 이름으로 인사", () => {
    const r = row("P0031025", "참여기관");
    const d = buildDraft(r, opts);
    expect(d.lang).toBe("en");
    expect(d.body).toContain(`Dear ${r.institution.contactName},`);
    expect(d.body).toContain("- Letter of Commitment");
    expect(d.body).toContain("Deadline: Tuesday, 15 December 2026");
    expect(d.subject).toContain("Document request for project P0031025");
  });

  it("두 번째 독촉은 재안내로 표시", () => {
    expect(buildDraft(row("P0031025", "주관기관"), opts, "ko", 1).subject.startsWith("[재안내] ")).toBe(true);
    expect(buildDraft(row("P0031025", "참여기관"), opts, "en", 2).subject.startsWith("Reminder: ")).toBe(true);
  });

  it("받는 사람 주소 확인", () => {
    expect(parseRecipients("a@x.com, b@y.org; bad, A@X.com")).toEqual({ ok: ["a@x.com", "b@y.org"], bad: ["bad"] });
  });

  it("독촉 횟수는 실제 발송만 센다", () => {
    const base = { projectId: "P", institution: "I", to: "", subject: "", docs: [] };
    const m = logSummary([
      { ...base, key: "k", at: "2026-12-01T00:00:00Z", mode: "발송", ok: true },
      { ...base, key: "k", at: "2026-12-03T00:00:00Z", mode: "시험 발송", ok: true },
      { ...base, key: "k", at: "2026-12-04T00:00:00Z", mode: "발송", ok: false },
      { ...base, key: "k", at: "2026-12-05T00:00:00Z", mode: "메일 프로그램", ok: true },
    ]);
    expect(m.get("k")).toEqual({ count: 2, last: "2026-12-05T00:00:00Z" });
  });
});

describe("메일 발송", () => {
  const received: { to: string[]; data: string }[] = [];
  let server: SMTPServer;
  const call = (body: unknown, headers: Record<string, string> = {}) =>
    send(new Request("http://x/api/mail/send", { method: "POST", headers, body: JSON.stringify(body) }));

  beforeAll(async () => {
    server = new SMTPServer({
      authOptional: true,
      disabledCommands: ["STARTTLS"],
      onAuth: (_a, _s, cb) => cb(null, { user: "u" }),
      onData(stream, session, cb) {
        let data = "";
        stream.on("data", (c) => (data += c));
        stream.on("end", () => {
          received.push({ to: session.envelope.rcptTo.map((r) => r.address), data });
          cb();
        });
      },
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    Object.assign(process.env, {
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String((server.server.address() as AddressInfo).port),
      SMTP_USER: "sender@kiat-demo.example.kr",
      SMTP_PASS: "x",
      EMAIL_FROM_NAME: "국제협력전략실",
      EMAIL_REPLY_TO: "owner@kiat-demo.example.kr",
      EMAIL_ALLOWED_RECIPIENTS: "me@test.example, @partner.example",
    });
    resetTransportForTest();
  });
  afterAll(() => {
    server.close();
    for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "EMAIL_FROM_NAME", "EMAIL_REPLY_TO", "EMAIL_ALLOWED_RECIPIENTS", "APP_PASSWORD"]) delete process.env[k];
  });

  it("허용 목록 규칙", () => {
    const rules = ["me@test.example", "@partner.example"];
    expect(isAllowed("ME@test.example", rules)).toBe(true);
    expect(isAllowed("x@partner.example", rules)).toBe(true);
    expect(isAllowed("x@other.example", rules)).toBe(false);
    expect(isAllowed("anyone@x.com", ["*"])).toBe(true);
  });

  it("허용된 주소로만 실제 발송하고, 아닌 주소는 막는다", async () => {
    const res = await call({
      messages: [
        { id: "a", to: ["anna@partner.example"], subject: "제목A", body: "본문A" },
        { id: "b", to: ["boss@other.example"], subject: "제목B", body: "본문B" },
      ],
    });
    const data = await res.json();
    expect(data.results[0]).toMatchObject({ id: "a", ok: true });
    expect(data.results[1].ok).toBe(false);
    expect(data.results[1].error).toContain("허용 목록");
    expect(received).toHaveLength(1);
    expect(received[0].to).toEqual(["anna@partner.example"]);
    expect(received[0].data).toMatch(/Reply-To: owner@kiat-demo\.example\.kr/i);
  });

  it("시험 발송은 받는 사람 대신 내 주소로, 제목에 표시", async () => {
    received.length = 0;
    const res = await call({ testTo: "me@test.example", messages: [{ id: "a", to: ["boss@other.example"], subject: "독촉", body: "본문" }] });
    const data = await res.json();
    expect(data.results[0].ok).toBe(true);
    expect(received[0].to).toEqual(["me@test.example"]);
    expect(received[0].data).toContain("=?UTF-8?");
  });

  it("비밀번호를 설정하면 없는 요청은 막는다", async () => {
    process.env.APP_PASSWORD = "pw";
    expect((await call({ messages: [{ id: "a", to: ["me@test.example"], subject: "s", body: "b" }] })).status).toBe(401);
    expect((await call({ messages: [{ id: "a", to: ["me@test.example"], subject: "s", body: "b" }] }, { "x-app-password": "pw" })).status).toBe(200);
    delete process.env.APP_PASSWORD;
  });

  it("SMTP 설정이 없으면 503", async () => {
    const host = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    expect((await call({ messages: [{ id: "a", to: ["me@test.example"], subject: "s", body: "b" }] })).status).toBe(503);
    process.env.SMTP_HOST = host;
  });
});
