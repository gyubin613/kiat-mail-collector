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

/** 보내는 메일 종류 */
export type MailKind = "독촉" | "보완 요청" | "접수 확인";

export interface ReminderDraft {
  kind: MailKind;
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
  kind?: MailKind;
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
    kind: "독촉",
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

const DEFAULT_FIX_KO = "내용 확인이 필요합니다";
const DEFAULT_FIX_EN = "please check and resend";
const FIX_EN: Record<string, string> = {
  "서명 없음": "the signature is missing",
  "날짜 없음": "the date is missing",
  "기관명 없음": "the institution name is missing",
  "과제번호 없음": "the project number is missing",
};

/** 보완 사유를 영문 메일용으로. 알 수 없는 한국어 문장은 기본 문구로 바꾼다 */
export function fixNoteEn(note: string): string {
  let out = note || "";
  for (const [ko, en] of Object.entries(FIX_EN)) out = out.split(ko).join(en);
  if (!out.trim() || /[가-힣]/.test(out)) return DEFAULT_FIX_EN;
  return out;
}

/** 보완 요청: 최근 제출본이 '보완 필요'인 서류와 사유 */
export function buildFixDraft(row: InstitutionStatusRow, opts: ReminderOptions, lang: Lang = defaultLang(row)): ReminderDraft {
  const p = row.project;
  const inst = row.institution;
  const items = row.fixDocs;
  const docs = items.map((i) => i.doc);
  const submitTo = opts.submitTo.trim() || "(제출받을 메일 주소)";
  let subject: string;
  let body: string;
  if (lang === "ko") {
    const fileOrg = shortOrg(inst.name, 14);
    subject = `[KIAT] ${p.id} 제출 서류 보완 요청 (${docs.join(", ")})`;
    body = [
      `${inst.name}${inst.contactName ? ` ${inst.contactName}` : ""} 님께`,
      "",
      "안녕하십니까. 한국산업기술진흥원 국제협력전략실입니다.",
      `「${p.name}」(${p.id}) 과제와 관련하여 보내주신 서류를 확인한 결과, 아래 사항의 보완을 요청드립니다.`,
      "",
      ...items.map((i) => `■ ${i.doc}: ${i.note || DEFAULT_FIX_KO}`),
      "",
      `■ 다시 제출할 기한: ${deadlineKo(opts.deadline)}`,
      `■ 제출 방법: ${submitTo} 로 메일 제출`,
      `■ 파일 이름: ${p.id}_${fileOrg}_서류종류.pdf`,
      "",
      "번거롭게 해 드려 죄송합니다. 문의 사항은 이 메일에 회신해 주시기 바랍니다.",
      "",
      "감사합니다.",
      "",
      opts.signature.trim(),
    ].join("\n");
  } else {
    const fileOrg = shortOrg(inst.name, 20).replace(/\s+/g, "_");
    subject = `[KIAT] Revision needed for project ${p.id} (${docs.map((d) => DOC_FILE_EN[d]?.replace(/_/g, " ") ?? d).join(", ")})`;
    body = [
      `Dear ${inst.contactName || "Sir or Madam"},`,
      "",
      "Greetings from the International Cooperation team at the Korea Institute for Advancement of Technology (KIAT).",
      `Thank you for sending the documents for the joint project "${p.nameEn || p.name}" (${p.id}). After reviewing them, we kindly ask you to revise the following:`,
      "",
      ...items.map((i) => `- ${docEn(i.doc)}: ${fixNoteEn(i.note)}`),
      "",
      `Please resend by: ${deadlineEn(opts.deadline)}`,
      `How to submit: please email the revised documents to ${submitTo}.`,
      `File name: ${p.id}_${fileOrg}_Document.pdf`,
      "",
      "We apologize for the inconvenience. Simply reply to this email if you have any questions.",
      "",
      "Best regards,",
      "",
      opts.signature.trim(),
    ].join("\n");
  }
  return { kind: "보완 요청", key: inst.key, projectId: p.id, institution: inst.name, lang, to: inst.emails.join(", "), subject, body, docs, edited: false };
}

/** 접수 확인: 받은 서류와 아직 남은 서류 */
export function buildReceiptDraft(row: InstitutionStatusRow, opts: ReminderOptions, lang: Lang = defaultLang(row)): ReminderDraft {
  const p = row.project;
  const inst = row.institution;
  const got = row.receivedDocs;
  const left = row.remindDocs;
  let subject: string;
  let body: string;
  if (lang === "ko") {
    subject = `[KIAT] ${p.id} 제출 서류 접수 확인 (${got.join(", ")})`;
    body = [
      `${inst.name}${inst.contactName ? ` ${inst.contactName}` : ""} 님께`,
      "",
      "안녕하십니까. 한국산업기술진흥원 국제협력전략실입니다.",
      `「${p.name}」(${p.id}) 과제와 관련하여 보내주신 아래 서류를 잘 받았습니다.`,
      "",
      `■ 받은 서류: ${got.join(", ")}`,
      left.length
        ? `■ 아직 받지 못한 서류: ${left.join(", ")} (기한: ${deadlineKo(opts.deadline)})`
        : "■ 요청드린 서류를 모두 받았습니다.",
      "",
      "서류 확인 중 보완이 필요하면 다시 연락드리겠습니다.",
      "",
      "감사합니다.",
      "",
      opts.signature.trim(),
    ].join("\n");
  } else {
    subject = `[KIAT] Documents received for project ${p.id}`;
    body = [
      `Dear ${inst.contactName || "Sir or Madam"},`,
      "",
      "Greetings from the International Cooperation team at the Korea Institute for Advancement of Technology (KIAT).",
      `We confirm that we have received the following document(s) for the joint project "${p.nameEn || p.name}" (${p.id}):`,
      "",
      ...got.map((d) => `- ${docEn(d)}`),
      "",
      left.length
        ? `Still outstanding: ${left.map(docEn).join(", ")} (deadline: ${deadlineEn(opts.deadline)})`
        : "We have now received all the requested documents.",
      "",
      "We will contact you if any revision is needed after our review.",
      "",
      "Best regards,",
      "",
      opts.signature.trim(),
    ].join("\n");
  }
  return { kind: "접수 확인", key: inst.key, projectId: p.id, institution: inst.name, lang, to: inst.emails.join(", "), subject, body, docs: got, edited: false };
}

export function buildMessage(kind: MailKind, row: InstitutionStatusRow, opts: ReminderOptions, lang?: Lang, previousCount = 0): ReminderDraft {
  if (kind === "보완 요청") return buildFixDraft(row, opts, lang);
  if (kind === "접수 확인") return buildReceiptDraft(row, opts, lang);
  return buildDraft(row, opts, lang, previousCount);
}

/** 이 기관에 이 종류 메일을 보낼 수 있는지 */
export function eligible(kind: MailKind, row: InstitutionStatusRow): boolean {
  if (!row.institution.emails.length) return false;
  if (kind === "독촉") return row.remindDocs.length > 0;
  if (kind === "보완 요청") return row.fixDocs.length > 0;
  return row.receivedDocs.length > 0;
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
export function logSummary(log: ReminderLogEntry[], kind: MailKind = "독촉"): Map<string, { count: number; last: string }> {
  const m = new Map<string, { count: number; last: string }>();
  for (const e of log) {
    if (!e.ok || e.mode === "시험 발송" || (e.kind ?? "독촉") !== kind) continue;
    const cur = m.get(e.key) ?? { count: 0, last: "" };
    m.set(e.key, { count: cur.count + 1, last: e.at > cur.last ? e.at : cur.last });
  }
  return m;
}
