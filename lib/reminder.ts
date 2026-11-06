// 미제출 기관 독촉 메일 초안 (국문·영문)
import type { InstitutionStatusRow } from "./organize";
import { shortOrg } from "./organize";

export interface ReminderOptions {
  /** 제출 기한 YYYY-MM-DD */
  deadline: string;
  /** 서류를 받을 메일 주소 */
  submitTo: string;
  /** 서명 (여러 줄) */
  signature: string;
  /** K-PASS 운영 중단 안내 문구 넣기 */
  kpassClosed: boolean;
}

export type Lang = "ko" | "en";

export interface ReminderDraft {
  key: string;
  projectId: string;
  institution: string;
  lang: Lang;
  to: string;
  subject: string;
  body: string;
  docs: string[];
  /** 담당자가 직접 고쳤는지 (설정을 바꿔도 덮어쓰지 않음) */
  edited: boolean;
}

export interface ReminderLogEntry {
  key: string;
  projectId: string;
  institution: string;
  to: string;
  subject: string;
  docs: string[];
  at: string;
  mode: "발송" | "시험 발송" | "메일 프로그램";
  ok: boolean;
  error?: string;
}

const DOC_EN: Record<string, string> = {
  참여확약서: "Letter of Commitment",
  협약서: "Signed Agreement",
  재무증빙: "Financial documents (financial statements, audit report)",
};
const DOC_FILE_EN: Record<string, string> = {
  참여확약서: "Letter_of_Commitment",
  협약서: "Agreement",
  재무증빙: "Financial_Statement",
};

export const docEn = (d: string) => DOC_EN[d] ?? d;

function parseDate(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || "");
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

export function deadlineKo(ymd: string): string {
  const d = parseDate(ymd);
  if (!d) return "별도 안내";
  const wd = "일월화수목금토"[d.getUTCDay()];
  return `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${wd})`;
}

export function deadlineEn(ymd: string): string {
  const d = parseDate(ymd);
  if (!d) return "to be announced";
  // 브라우저마다 날짜 표기가 달라지지 않도록 직접 만든다
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function defaultLang(row: InstitutionStatusRow): Lang {
  return row.institution.foreign ? "en" : "ko";
}

export function buildDraft(
  row: InstitutionStatusRow,
  opts: ReminderOptions,
  lang: Lang = defaultLang(row),
  previousCount = 0,
): ReminderDraft {
  const p = row.project;
  const inst = row.institution;
  const docs = row.remindDocs;
  const again = previousCount > 0;
  const submitTo = opts.submitTo.trim() || "(제출받을 메일 주소)";
  let subject: string;
  let body: string;

  if (lang === "ko") {
    const fileOrg = shortOrg(inst.name, 14);
    subject = `${again ? "[재안내] " : ""}[KIAT] ${p.id} 과제 제출 서류 요청 (${docs.join(", ")})`;
    body = [
      `${inst.name}${inst.contactName ? ` ${inst.contactName}` : ""} 님께`,
      "",
      "안녕하십니까. 한국산업기술진흥원 국제협력전략실입니다.",
      `「${p.name}」(${p.id}) 과제와 관련하여 아래 서류가 아직 접수되지 않아 ${again ? "다시 한번 " : ""}제출을 요청드립니다.`,
      "",
      `■ 제출 요청 서류: ${docs.join(", ")}`,
      `■ 제출 기한: ${deadlineKo(opts.deadline)}`,
      `■ 제출 방법: ${submitTo} 로 메일 제출${opts.kpassClosed ? " (K-PASS 운영 중단 기간에는 메일로 받습니다)" : ""}`,
      `■ 파일 이름: ${p.id}_${fileOrg}_서류종류.pdf (예: ${p.id}_${fileOrg}_${docs[0] ?? "서류"}.pdf)`,
      "",
      "이미 제출하셨다면 이 메일은 넘기셔도 됩니다. 문의 사항은 이 메일에 회신해 주시기 바랍니다.",
      "",
      "감사합니다.",
      "",
      opts.signature.trim(),
    ].join("\n");
  } else {
    const fileOrg = shortOrg(inst.name, 20).replace(/\s+/g, "_");
    const title = p.nameEn || p.name;
    subject = `${again ? "Reminder: " : ""}[KIAT] Document request for project ${p.id} (${docs.map((d) => DOC_FILE_EN[d]?.replace(/_/g, " ") ?? d).join(", ")})`;
    body = [
      `Dear ${inst.contactName || "Sir or Madam"},`,
      "",
      "Greetings from the International Cooperation team at the Korea Institute for Advancement of Technology (KIAT).",
      `For the joint project "${title}" (${p.id}), we have not yet received the following document(s) from ${inst.name}${again ? ", and we would like to remind you kindly" : ""}:`,
      "",
      ...docs.map((d) => `- ${docEn(d)}`),
      "",
      `Deadline: ${deadlineEn(opts.deadline)}`,
      `How to submit: please email the documents to ${submitTo}.${opts.kpassClosed ? " (Our online submission system is closed for the year-end period.)" : ""}`,
      `File name: ${p.id}_${fileOrg}_Document.pdf (e.g., ${p.id}_${fileOrg}_${DOC_FILE_EN[docs[0]] ?? "Document"}.pdf)`,
      "",
      "If you have already sent them, please disregard this message. Simply reply to this email if you have any questions.",
      "",
      "Best regards,",
      "",
      opts.signature.trim(),
    ].join("\n");
  }

  return {
    key: inst.key,
    projectId: p.id,
    institution: inst.name,
    lang,
    to: inst.emails.join(", "),
    subject,
    body,
    docs,
    edited: false,
  };
}

/** "a@x.com, b@y.com" → 주소 목록 (형식이 틀린 주소는 따로) */
export function parseRecipients(s: string): { ok: string[]; bad: string[] } {
  const parts = (s || "")
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const ok: string[] = [];
  const bad: string[] = [];
  for (const p of parts) (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p) ? ok : bad).push(p.toLowerCase());
  return { ok: [...new Set(ok)], bad };
}

export function mailtoHref(d: ReminderDraft): string {
  const to = parseRecipients(d.to).ok.join(",");
  return `mailto:${to}?subject=${encodeURIComponent(d.subject)}&body=${encodeURIComponent(d.body)}`;
}

const LOG_KEY = "kiat-reminder-log-v1";

export function loadLog(): ReminderLogEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveLog(log: ReminderLogEntry[]) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-2000)));
  } catch {
    /* 저장소를 쓸 수 없는 환경 */
  }
}

/** 기관별 실제 발송(시험 발송 제외) 횟수와 마지막 날짜 */
export function logSummary(log: ReminderLogEntry[]): Map<string, { count: number; last: string }> {
  const m = new Map<string, { count: number; last: string }>();
  for (const e of log) {
    if (!e.ok || e.mode === "시험 발송") continue;
    const cur = m.get(e.key) ?? { count: 0, last: "" };
    m.set(e.key, { count: cur.count + 1, last: e.at > cur.last ? e.at : cur.last });
  }
  return m;
}
