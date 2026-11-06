// 누적 접수대장: 서버에 남기는 기록과 화면 자료 사이의 변환, 재제출 차수, 제출 기한 계산
// 서버에는 메일 원문·첨부파일 내용을 남기지 않는다. 제목·보낸 사람·요약·첨부파일 이름/크기/해시와 분류 결과만 남긴다.
import type { AttachmentResult, KpassState, MailResult, ParsedMail, Project, Settings } from "./types";

export interface LedgerMail {
  key: string;
  messageId: string;
  sourceName: string;
  fromName: string;
  fromAddress: string;
  to: string;
  date: string;
  subject: string;
  attachments: { filename: string; mimeType: string; size: number; sha256: string }[];
  result: MailResult;
  via: "upload" | "imap";
  addedAt: string;
  addedBy: string;
}

export type EventType =
  | "접수"
  | "분류"
  | "독촉"
  | "접수 확인"
  | "보완 요청"
  | "점검"
  | "K-PASS"
  | "담당자 변경"
  | "메모"
  | "현황 갱신";

export interface LedgerEvent {
  id: string;
  at: string;
  by: string;
  type: EventType;
  projectId?: string;
  institutionKey?: string;
  mailKey?: string;
  text: string;
}

export interface ProjectsDoc {
  projects: Project[];
  sourceName: string;
  importedAt: string;
  importedBy: string;
}

export interface LedgerSnapshot {
  dept: { code: string; name: string; demo: boolean };
  user: string;
  storage: "upstash" | "memory";
  projects: ProjectsDoc | null;
  settings: Settings | null;
  mails: LedgerMail[];
  events: LedgerEvent[];
}

export function toLedgerMail(mail: ParsedMail, result: MailResult, user: string, via: "upload" | "imap", now = new Date()): LedgerMail {
  return {
    key: mail.id,
    messageId: mail.messageId,
    sourceName: mail.sourceName,
    fromName: mail.fromName,
    fromAddress: mail.fromAddress,
    to: mail.to,
    date: mail.date,
    subject: mail.subject,
    attachments: mail.attachments.map((a) => ({ filename: a.filename, mimeType: a.mimeType, size: a.size, sha256: a.sha256 })),
    result: { ...result, mailId: mail.id },
    via,
    addedAt: now.toISOString(),
    addedBy: user,
  };
}

/** 기록만 남은 메일을 화면용 자료로 (원문·첨부 내용 없음) */
export function fromLedgerMail(l: LedgerMail): { mail: ParsedMail; result: MailResult } {
  return {
    mail: {
      id: l.key,
      messageId: l.messageId,
      stub: true,
      sourceName: l.sourceName,
      fromName: l.fromName,
      fromAddress: l.fromAddress,
      to: l.to,
      date: l.date,
      subject: l.subject,
      text: l.result.summary || "",
      attachments: l.attachments.map((a) => ({ ...a, content: new Uint8Array(0) })),
      raw: new Uint8Array(0),
    },
    result: { ...l.result, mailId: l.key },
  };
}

/** 메일을 받은 날이 K-PASS 운영 중단 기간이면 첨부 서류를 '등록 대기'로 */
export function initialKpass(mailDate: string, settings: Settings, docType: string): KpassState {
  const { from, to } = settings.kpassWindow;
  if (!from || !to || docType === "기타") return "해당 없음";
  const d = kstDay(mailDate);
  return d && d >= from && d <= to ? "등록 대기" : "해당 없음";
}

export function kstDay(iso: string): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 기한까지 남은 날 (오늘 기준, KST). 기한 지나면 음수 */
export function daysLeft(deadline: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline || "")) return null;
  const today = kstDay(now.toISOString());
  return Math.round((Date.parse(deadline) - Date.parse(today)) / 86400000);
}

export function ddayLabel(n: number | null): string {
  if (n === null) return "";
  if (n > 0) return `D-${n}`;
  if (n === 0) return "D-day";
  return `${-n}일 지남`;
}

export interface VersionInfo {
  /** 같은 기관·서류의 몇 번째 제출인지 (1부터) */
  version: number;
  /** 같은 기관·서류 제출 횟수 */
  total: number;
  /** 가장 최근 제출본인지 */
  latest: boolean;
  /** 앞서 받은 파일과 내용이 똑같으면 그 메일 키 */
  duplicateOf?: string;
}

/** 첨부 서류별 재제출 차수와 중복 여부. 키: `${mailId}#${index}` */
export function computeVersions(mails: ParsedMail[], results: MailResult[]): Map<string, VersionInfo> {
  const mailById = new Map(mails.map((m) => [m.id, m]));
  const groups = new Map<string, { ref: string; date: string; sha: string; mailId: string }[]>();
  for (const r of results) {
    if (!r.projectId || (r.status !== "auto" && r.status !== "confirmed")) continue;
    const m = mailById.get(r.mailId);
    if (!m) continue;
    for (const a of r.attachments) {
      if (a.docType === "기타") continue;
      const g = `${r.projectId}|${r.institutionKey ?? "?"}|${a.docType}`;
      const sha = a.sha256 || m.attachments[a.index]?.sha256 || "";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g)!.push({ ref: `${r.mailId}#${a.index}`, date: m.date, sha, mailId: r.mailId });
    }
  }
  const out = new Map<string, VersionInfo>();
  for (const items of groups.values()) {
    items.sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref));
    const firstBySha = new Map<string, string>();
    let version = 0;
    const versions: { ref: string; version: number; duplicateOf?: string }[] = [];
    for (const it of items) {
      const dup = it.sha ? firstBySha.get(it.sha) : undefined;
      if (dup && dup !== it.mailId) {
        versions.push({ ref: it.ref, version, duplicateOf: dup });
        continue;
      }
      version += 1;
      if (it.sha) firstBySha.set(it.sha, it.mailId);
      versions.push({ ref: it.ref, version });
    }
    for (const v of versions) {
      out.set(v.ref, { version: v.version, total: version, latest: !v.duplicateOf && v.version === version, duplicateOf: v.duplicateOf });
    }
  }
  return out;
}

/** 결과 첨부 목록에 해시·크기를 채운다 (기록에 남기기 위함) */
export function withFileInfo(mail: ParsedMail, r: MailResult): MailResult {
  return {
    ...r,
    attachments: r.attachments.map(
      (a): AttachmentResult => ({ ...a, sha256: a.sha256 ?? mail.attachments[a.index]?.sha256, size: a.size ?? mail.attachments[a.index]?.size }),
    ),
  };
}

/** 기관별 소통 기록(독촉 등) 횟수와 마지막 날짜 */
export function contactSummary(events: LedgerEvent[], type: EventType = "독촉"): Map<string, { count: number; last: string }> {
  const m = new Map<string, { count: number; last: string }>();
  for (const e of events) {
    if (e.type !== type || !e.institutionKey) continue;
    const cur = m.get(e.institutionKey) ?? { count: 0, last: "" };
    m.set(e.institutionKey, { count: cur.count + 1, last: e.at > cur.last ? e.at : cur.last });
  }
  return m;
}

export interface KpassItem {
  ref: string;
  mailId: string;
  index: number;
  projectId: string;
  institutionKey: string | null;
  docType: string;
  filename: string;
  receivedAt: string;
  state: "등록 대기" | "등록 완료";
  doneAt?: string;
  doneBy?: string;
  /** 같은 서류의 최근 제출본인지 (예전 차수는 등록하지 않아도 됨) */
  latest: boolean;
}

export function kpassItems(mails: ParsedMail[], results: MailResult[], versions: Map<string, VersionInfo>): KpassItem[] {
  const byId = new Map(mails.map((m) => [m.id, m]));
  const out: KpassItem[] = [];
  for (const r of results) {
    if (!r.projectId || (r.status !== "auto" && r.status !== "confirmed")) continue;
    const m = byId.get(r.mailId);
    if (!m) continue;
    for (const a of r.attachments) {
      if (a.kpass !== "등록 대기" && a.kpass !== "등록 완료") continue;
      const ref = `${r.mailId}#${a.index}`;
      const v = versions.get(ref);
      out.push({
        ref,
        mailId: r.mailId,
        index: a.index,
        projectId: r.projectId,
        institutionKey: r.institutionKey,
        docType: a.docType,
        filename: a.filename,
        receivedAt: m.date,
        state: a.kpass,
        doneAt: a.kpassAt,
        doneBy: a.kpassBy,
        latest: v ? v.latest : true,
      });
    }
  }
  return out.sort((a, b) => a.projectId.localeCompare(b.projectId) || a.receivedAt.localeCompare(b.receivedAt));
}
