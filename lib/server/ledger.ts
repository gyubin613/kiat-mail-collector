// 실별 접수대장 저장 (서버 전용)
import { randomUUID } from "node:crypto";
import type { LedgerEvent, LedgerMail, LedgerSnapshot, ProjectsDoc } from "../ledger";
import { scrub } from "../projects";
import { DEFAULT_SETTINGS } from "../settings";
import type { AttachmentResult, Candidate, DocScope, Institution, MailResult, Project, Settings } from "../types";
import { getStore } from "./store";

const k = (dept: string, part: string) => `kmc:${dept}:${part}`;
const MAX_EVENTS = 5000;

const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const arr = <T>(v: unknown, max: number): T[] => (Array.isArray(v) ? (v.slice(0, max) as T[]) : []);
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// ---------- 과제관리 현황 ----------
function cleanInstitution(i: Partial<Institution>, projectId: string): Institution {
  const name = scrub(str(i.name, 120));
  return {
    key: `${projectId}::${name}`,
    projectId,
    name,
    role: i.role === "주관기관" ? "주관기관" : "참여기관",
    country: scrub(str(i.country, 60)),
    foreign: !!i.foreign,
    contactName: scrub(str(i.contactName, 60)),
    emails: arr<string>(i.emails, 10)
      .map((e) => str(e, 200).toLowerCase())
      .filter((e) => EMAIL.test(e)),
  };
}

/** 화면에서 보낸 현황을 서버에서 다시 걸러 필요한 칸만 남긴다 (전화번호 재확인 포함) */
export function cleanProjects(input: unknown): Project[] {
  return arr<Partial<Project>>(input, 2000).map((p) => {
    const id = str(p.id, 60).trim();
    const institutions = arr<Partial<Institution>>(p.institutions, 30).map((i) => cleanInstitution(i, id)).filter((i) => i.name);
    const partners = institutions.filter((i) => i.role === "참여기관");
    const main = partners.find((i) => i.foreign) ?? partners[0];
    return {
      id,
      name: scrub(str(p.name, 300)),
      nameEn: scrub(str(p.nameEn, 300)),
      leadOrg: institutions.find((i) => i.role === "주관기관")?.name ?? "",
      partnerOrg: main?.name ?? "",
      country: main?.country ?? "",
      manager: scrub(str(p.manager, 40)),
      year: str(p.year, 20),
      contacts: [...new Set(institutions.flatMap((i) => i.emails))],
      partnerContacts: [...new Set(partners.flatMap((i) => i.emails))],
      institutions,
    };
  }).filter((p) => p.id);
}

// ---------- 설정 ----------
const SCOPES: DocScope[] = ["주관기관", "참여기관", "모든 기관", "과제 공통"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function cleanSettings(input: unknown): Settings {
  const s = (input ?? {}) as Partial<Settings>;
  const docs = arr<string>(s.requiredDocs, 20).map((d) => str(d, 30).trim()).filter(Boolean);
  const requiredDocs = docs.length ? [...new Set(docs)] : DEFAULT_SETTINGS.requiredDocs;
  const docScope: Record<string, DocScope> = {};
  const deadlines: Record<string, string> = {};
  for (const d of requiredDocs) {
    const sc = (s.docScope ?? {})[d];
    docScope[d] = SCOPES.includes(sc as DocScope) ? (sc as DocScope) : DEFAULT_SETTINGS.docScope[d] ?? "모든 기관";
    const dl = (s.deadlines ?? {})[d];
    if (typeof dl === "string" && DATE.test(dl)) deadlines[d] = dl;
  }
  const kw: Record<string, string[]> = {};
  for (const d of requiredDocs) {
    const v = (s.docKeywords ?? {})[d] ?? DEFAULT_SETTINGS.docKeywords[d] ?? [d];
    kw[d] = arr<string>(v, 40).map((x) => str(x, 60)).filter(Boolean);
  }
  const win = s.kpassWindow ?? { from: "", to: "" };
  const submitTo = str(s.submitTo, 200).trim();
  return {
    ...DEFAULT_SETTINGS,
    requiredDocs,
    docScope,
    deadlines,
    docKeywords: kw,
    relevanceKeywords: arr<string>(s.relevanceKeywords ?? DEFAULT_SETTINGS.relevanceKeywords, 60).map((x) => str(x, 40)),
    autoThreshold: DEFAULT_SETTINGS.autoThreshold,
    reviewThreshold: DEFAULT_SETTINGS.reviewThreshold,
    kpassWindow: { from: DATE.test(win.from) ? win.from : "", to: DATE.test(win.to) ? win.to : "" },
    submitTo: !submitTo || EMAIL.test(submitTo) ? submitTo : "",
    imapFolder: str(s.imapFolder || "INBOX", 100),
  };
}

// ---------- 메일 기록 ----------
function cleanAttachmentResult(a: Partial<AttachmentResult>): AttachmentResult {
  const check = a.check
    ? {
        state: (["미점검", "이상 없음", "보완 필요"] as const).includes(a.check.state) ? a.check.state : "미점검",
        note: str(a.check.note, 500),
        by: a.check.by ? str(a.check.by, 40) : undefined,
        at: a.check.at ? str(a.check.at, 40) : undefined,
        auto: a.check.auto
          ? {
              kind: (["text", "scan", "other", "error"] as const).includes(a.check.auto.kind) ? a.check.auto.kind : "other",
              suggestion: (["ok", "fix", "manual"] as const).includes(a.check.auto.suggestion) ? a.check.auto.suggestion : "manual",
              items: arr<{ label: string; ok: boolean | null; detail: string }>(a.check.auto.items, 10).map((i) => ({
                label: str(i.label, 40),
                ok: i.ok === true ? true : i.ok === false ? false : null,
                detail: str(i.detail, 200),
              })),
            }
          : undefined,
      }
    : undefined;
  return {
    index: Number(a.index) || 0,
    filename: str(a.filename, 200),
    docType: str(a.docType, 30) || "기타",
    docReason: str(a.docReason, 120),
    sha256: a.sha256 ? str(a.sha256, 64) : undefined,
    size: Number(a.size) || undefined,
    check,
    kpass: a.kpass === "등록 대기" || a.kpass === "등록 완료" ? a.kpass : a.kpass ? "해당 없음" : undefined,
    kpassAt: a.kpassAt ? str(a.kpassAt, 40) : undefined,
    kpassBy: a.kpassBy ? str(a.kpassBy, 40) : undefined,
  };
}

export function cleanResult(r: Partial<MailResult>, key: string): MailResult {
  const statuses = ["auto", "confirmed", "review", "unmatched", "excluded"] as const;
  return {
    mailId: key,
    relevant: r.relevant !== false,
    relevanceReason: str(r.relevanceReason, 200),
    projectId: r.projectId ? str(r.projectId, 60) : null,
    institutionKey: r.institutionKey ? str(r.institutionKey, 200) : null,
    institutionReason: str(r.institutionReason, 120),
    confidence: Math.max(0, Math.min(100, Number(r.confidence) || 0)),
    status: statuses.includes(r.status as never) ? (r.status as MailResult["status"]) : "unmatched",
    reasons: arr<string>(r.reasons, 12).map((x) => str(x, 200)),
    candidates: arr<Candidate>(r.candidates, 5).map((c) => ({
      projectId: str(c.projectId, 60),
      score: Number(c.score) || 0,
      reasons: arr<string>(c.reasons, 8).map((x) => str(x, 120)),
      strong: !!c.strong,
    })),
    attachments: arr<Partial<AttachmentResult>>(r.attachments, 50).map(cleanAttachmentResult),
    summary: str(r.summary, 400),
    edited: !!r.edited,
    aiAssisted: !!r.aiAssisted,
  };
}

export function cleanLedgerMail(m: Partial<LedgerMail>, user: string): LedgerMail | null {
  const key = str(m.key, 40);
  if (!/^[mr][0-9a-f]{16}$/.test(key)) return null;
  return {
    key,
    messageId: str(m.messageId, 300),
    sourceName: str(m.sourceName, 200),
    fromName: str(m.fromName, 120),
    fromAddress: str(m.fromAddress, 200).toLowerCase(),
    to: str(m.to, 500),
    date: str(m.date, 40),
    subject: str(m.subject, 300),
    attachments: arr<LedgerMail["attachments"][number]>(m.attachments, 50).map((a) => ({
      filename: str(a.filename, 200),
      mimeType: str(a.mimeType, 100),
      size: Number(a.size) || 0,
      sha256: str(a.sha256, 64),
    })),
    result: cleanResult(m.result ?? {}, key),
    via: m.via === "imap" ? "imap" : "upload",
    addedAt: new Date().toISOString(),
    addedBy: str(user, 40),
  };
}

// ---------- 저장·조회 ----------
export async function snapshot(dept: { code: string; name: string; demo: boolean }, user: string): Promise<LedgerSnapshot> {
  const st = getStore();
  const [projects, settings, mails, events] = await Promise.all([
    st.get<ProjectsDoc>(k(dept.code, "projects")),
    st.get<Settings>(k(dept.code, "settings")),
    st.hgetall<LedgerMail>(k(dept.code, "mails")),
    st.lrange<LedgerEvent>(k(dept.code, "events"), -2000, -1),
  ]);
  return {
    dept,
    user,
    storage: st.kind,
    projects,
    settings: settings ? cleanSettings(settings) : null,
    mails: Object.values(mails).sort((a, b) => a.date.localeCompare(b.date)),
    events,
  };
}

export async function saveProjects(dept: string, user: string, projects: unknown, sourceName: string): Promise<ProjectsDoc> {
  const doc: ProjectsDoc = { projects: cleanProjects(projects), sourceName: str(sourceName, 200), importedAt: new Date().toISOString(), importedBy: user };
  await getStore().set(k(dept, "projects"), doc);
  await addEvents(dept, user, [{ type: "현황 갱신", text: `과제관리 현황을 새로 올림 (${doc.sourceName}, 과제 ${doc.projects.length}개)` }]);
  return doc;
}

export async function saveSettings(dept: string, input: unknown): Promise<Settings> {
  const s = cleanSettings(input);
  await getStore().set(k(dept, "settings"), s);
  return s;
}

export async function addMails(dept: string, user: string, input: unknown[]): Promise<{ added: string[]; skipped: string[] }> {
  const st = getStore();
  const added: string[] = [];
  const skipped: string[] = [];
  const events: Omit<LedgerEvent, "id" | "at" | "by">[] = [];
  for (const raw of input.slice(0, 500)) {
    const m = cleanLedgerMail(raw as Partial<LedgerMail>, user);
    if (!m) continue;
    if (await st.hsetnx(k(dept, "mails"), m.key, m)) {
      added.push(m.key);
      const docs = m.result.attachments.filter((a) => a.docType !== "기타").map((a) => a.docType);
      if (m.result.relevant && m.result.status !== "excluded") {
        events.push({
          type: "접수",
          projectId: m.result.projectId ?? undefined,
          institutionKey: m.result.institutionKey ?? undefined,
          mailKey: m.key,
          text: `메일 접수: ${m.subject}${docs.length ? ` (${docs.join(", ")})` : ""}`,
        });
      }
    } else skipped.push(m.key);
  }
  await addEvents(dept, user, events);
  return { added, skipped };
}

export async function updateMail(dept: string, key: string, result: unknown): Promise<LedgerMail | null> {
  const st = getStore();
  const cur = await st.hget<LedgerMail>(k(dept, "mails"), key);
  if (!cur) return null;
  const next: LedgerMail = { ...cur, result: cleanResult(result as Partial<MailResult>, key) };
  await st.hset(k(dept, "mails"), { [key]: next });
  return next;
}

export async function addEvents(dept: string, user: string, input: Partial<LedgerEvent>[]): Promise<LedgerEvent[]> {
  const types = ["접수", "분류", "독촉", "접수 확인", "보완 요청", "점검", "K-PASS", "담당자 변경", "메모", "현황 갱신"];
  const now = new Date().toISOString();
  const events: LedgerEvent[] = input
    .slice(0, 500)
    .filter((e) => types.includes(String(e.type)) && e.text)
    .map((e) => ({
      id: randomUUID(),
      at: now,
      by: str(user, 40),
      type: e.type as LedgerEvent["type"],
      projectId: e.projectId ? str(e.projectId, 60) : undefined,
      institutionKey: e.institutionKey ? str(e.institutionKey, 200) : undefined,
      mailKey: e.mailKey ? str(e.mailKey, 40) : undefined,
      text: str(e.text, 1000),
    }));
  await getStore().rpushCapped(k(dept, "events"), events, MAX_EVENTS);
  return events;
}

/** 담당자 이관: 과제 담당자를 바꾸고 기록을 남긴다 */
export async function transferProjects(dept: string, user: string, from: string, to: string, ids: string[]): Promise<ProjectsDoc | null> {
  const st = getStore();
  const doc = await st.get<ProjectsDoc>(k(dept, "projects"));
  if (!doc) return null;
  const target = new Set(ids);
  const toName = scrub(str(to, 40)).trim();
  if (!toName) throw new Error("새 담당자 이름을 입력해 주세요.");
  const moved: string[] = [];
  for (const p of doc.projects) {
    if (target.has(p.id) && p.manager === from) {
      p.manager = toName;
      moved.push(p.id);
    }
  }
  await st.set(k(dept, "projects"), doc);
  await addEvents(
    dept,
    user,
    moved.map((id) => ({ type: "담당자 변경" as const, projectId: id, text: `담당자 변경: ${from || "(없음)"} → ${toName}` })),
  );
  return doc;
}

export async function resetDept(dept: string) {
  const st = getStore();
  await Promise.all(["projects", "settings", "mails", "events"].map((p) => st.del(k(dept, p))));
}
