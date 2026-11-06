import { emailDomain, extOf, kstDateTime, safeFileName, ymd } from "./text";
import type { CheckState, DocScope, Institution, MailResult, ParsedMail, Project, Settings } from "./types";

export const UNMATCHED_FOLDER = "00_미분류";
export const REVIEW_FOLDER = "01_확인필요";
export const MAIL_ARCHIVE_FOLDER = "_메일원문";

export interface PlannedFile {
  mailId: string;
  /** 첨부 순번. 메일 원문(.eml)이면 -1 */
  attachmentIndex: number;
  projectId: string | null;
  docType: string;
  originalName: string;
  standardName: string;
  /** 최상위 폴더 아래 상대 경로 */
  path: string;
  size: number;
  receivedAt: string;
  /** 이번 작업에 파일 내용이 있는지 (이전 작업 기록만 있으면 false) */
  available: boolean;
}

/** 파일명에 넣을 짧은 기관명: "(주)한빛로보틱스" → "한빛로보틱스", "Nordlicht Institute of Technology" → "Nordlicht Institute" */
export function shortOrg(org: string, max = 20): string {
  let s = (org || "").replace(/\(주\)|㈜|주식회사|\(유\)|유한회사|재단법인|사단법인/g, "").trim();
  if (/[가-힣]/.test(s)) return safeFileName(s.replace(/\s+/g, ""), max);
  const words = s.replace(/[,.]/g, " ").split(/\s+/).filter(Boolean);
  const stop = new Set(["of", "for", "and", "the", "inc", "ltd", "gmbh", "co", "corp"]);
  let out = "";
  for (const w of words) {
    if (stop.has(w.toLowerCase())) break;
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  return safeFileName(out || words[0] || s, max);
}

export function projectFolderName(p: Project): string {
  return safeFileName(`${p.id}_${p.name}`, 50);
}

/** 보낸 기관 이름: 기관이 정해졌으면 그 이름, 아니면 보낸 사람 이름이나 도메인 */
export function senderOrg(mail: ParsedMail, institution: Institution | undefined): string {
  if (institution) return institution.name;
  return mail.fromName || emailDomain(mail.fromAddress) || "발신기관 미상";
}

/** 과제·서류 종류 기준으로 파일 이름과 폴더 위치를 정한다 */
export function planFiles(
  mails: ParsedMail[],
  results: MailResult[],
  projects: Project[],
): PlannedFile[] {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const resultById = new Map(results.map((r) => [r.mailId, r]));
  const used = new Set<string>();
  const unique = (path: string) => {
    if (!used.has(path)) {
      used.add(path);
      return path;
    }
    const dot = path.lastIndexOf(".");
    const base = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
    const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
    let n = 2;
    while (used.has(`${base}_${n}${ext}`)) n += 1;
    const p = `${base}_${n}${ext}`;
    used.add(p);
    return p;
  };

  const out: PlannedFile[] = [];
  for (const mail of mails) {
    const r = resultById.get(mail.id);
    if (!r || r.status === "excluded") continue;
    const settled = r.status === "auto" || r.status === "confirmed";
    const project = settled && r.projectId ? byId.get(r.projectId) : undefined;
    const folder = project ? projectFolderName(project) : r.status === "review" ? REVIEW_FOLDER : UNMATCHED_FOLDER;
    const date = ymd(mail.date);
    const inst = project?.institutions.find((i) => i.key === r.institutionKey);
    const org = shortOrg(senderOrg(mail, inst));

    mail.attachments.forEach((a, i) => {
      const docType = r.attachments[i]?.docType || "기타";
      const ext = extOf(a.filename);
      const origStem = safeFileName(a.filename.replace(/\.[^.]+$/, ""), 30);
      const stem = project
        ? `${project.id}_${org}_${docType}_${date}_${origStem}`
        : `${date}_${safeFileName(mail.fromAddress, 40)}_${safeFileName(a.filename.replace(/\.[^.]+$/, ""), 40)}`;
      const standardName = `${safeFileName(stem, 90)}${ext ? "." + ext : ""}`;
      const path = unique(project ? `${folder}/${docType}/${standardName}` : `${folder}/${standardName}`);
      out.push({
        mailId: mail.id,
        attachmentIndex: i,
        projectId: project?.id ?? null,
        docType,
        originalName: a.filename,
        standardName: path.split("/").pop()!,
        path,
        size: a.size,
        receivedAt: mail.date,
        available: !mail.stub,
      });
    });

    const emlName = `${date}_${safeFileName(mail.subject, 50)}.eml`;
    const emlPath = unique(`${folder}/${MAIL_ARCHIVE_FOLDER}/${emlName}`);
    out.push({
      mailId: mail.id,
      attachmentIndex: -1,
      projectId: project?.id ?? null,
      docType: "메일원문",
      originalName: mail.sourceName,
      standardName: emlPath.split("/").pop()!,
      path: emlPath,
      size: mail.raw.byteLength,
      receivedAt: mail.date,
      available: !mail.stub,
    });
  }
  return out;
}

export type DocState = {
  receivedAt: string;
  /** 받은 횟수 (중복 파일 포함) */
  count: number;
  /** 가장 최근 제출본: `${mailId}#${index}` */
  latestRef?: string;
  /** 최근 제출본 점검 상태 */
  checkState?: CheckState;
  /** 자동 점검 추정 (담당자 판정 전) */
  autoSuggestion?: "ok" | "fix" | "manual";
  /** 보완 필요일 때 메모 */
  fixNote?: string;
};

export interface InstitutionStatusRow {
  project: Project;
  institution: Institution;
  /** 이 기관이 내야 하는 서류 */
  required: string[];
  docs: Record<string, DocState | null>;
  /** 이 기관 자신의 미제출 서류 */
  missing: string[];
  /** 독촉 대상 서류 (주관기관은 과제 공통 미제출 서류도 포함) */
  remindDocs: string[];
  /** 보완 요청 대상 (최근 제출본이 '보완 필요') */
  fixDocs: { doc: string; note: string }[];
  /** 받은 서류 (접수 확인 메일용) */
  receivedDocs: string[];
  lastReceived: string;
}

export interface ProjectStatusRow {
  project: Project;
  /** 과제 공통 서류 (과제당 1부) */
  common: Record<string, DocState | null>;
  commonMissing: string[];
  institutions: InstitutionStatusRow[];
  /** 기관을 알 수 없는 메일로 들어온 서류 수 */
  unassigned: number;
  /** 과제 전체에서 빠진 서류 (기관명 포함) */
  missingLabels: string[];
  lastReceived: string;
  state: "완료" | "일부 제출" | "미제출";
}

export function requiredFor(inst: Institution, settings: Settings): string[] {
  return settings.requiredDocs.filter((d) => {
    const scope: DocScope = settings.docScope[d] ?? "모든 기관";
    return scope === "모든 기관" || scope === inst.role;
  });
}

export function commonDocs(settings: Settings): string[] {
  return settings.requiredDocs.filter((d) => settings.docScope[d] === "과제 공통");
}

function bump(cur: DocState | null | undefined, date: string, ref: string, a: MailResult["attachments"][number]): DocState {
  const newer = !cur || date >= cur.receivedAt;
  if (!newer) return { ...cur!, count: cur!.count + 1 };
  return {
    receivedAt: date,
    count: (cur?.count ?? 0) + 1,
    latestRef: ref,
    checkState: a.check?.state ?? "미점검",
    autoSuggestion: a.check?.auto?.suggestion,
    fixNote: a.check?.state === "보완 필요" ? a.check.note : undefined,
  };
}

/** 과제·기관별 서류 제출 현황 */
export function projectStatus(
  mails: ParsedMail[],
  results: MailResult[],
  projects: Project[],
  settings: Settings,
): ProjectStatusRow[] {
  const mailById = new Map(mails.map((m) => [m.id, m]));
  const commons = commonDocs(settings);
  return projects.map((p) => {
    const common: Record<string, DocState | null> = Object.fromEntries(commons.map((d) => [d, null]));
    const rows: InstitutionStatusRow[] = p.institutions.map((inst) => {
      const required = requiredFor(inst, settings);
      return {
        project: p,
        institution: inst,
        required,
        docs: Object.fromEntries(required.map((d) => [d, null])),
        missing: [],
        remindDocs: [],
        fixDocs: [],
        receivedDocs: [],
        lastReceived: "",
      };
    });
    const rowByKey = new Map(rows.map((r) => [r.institution.key, r]));
    let unassigned = 0;
    let lastReceived = "";
    const mine = results
      .filter((r) => r.projectId === p.id && (r.status === "auto" || r.status === "confirmed"))
      .map((r) => ({ r, m: mailById.get(r.mailId) }))
      .filter((x): x is { r: MailResult; m: ParsedMail } => !!x.m)
      .sort((a, b) => a.m.date.localeCompare(b.m.date));
    for (const { r, m } of mine) {
      if (m.date > lastReceived) lastReceived = m.date;
      const row = r.institutionKey ? rowByKey.get(r.institutionKey) : undefined;
      if (row && m.date > row.lastReceived) row.lastReceived = m.date;
      for (const a of r.attachments) {
        const ref = `${r.mailId}#${a.index}`;
        if (row && a.docType !== "기타" && !row.receivedDocs.includes(a.docType)) row.receivedDocs.push(a.docType);
        if (a.docType in common) {
          common[a.docType] = bump(common[a.docType], m.date, ref, a);
        } else if (row && a.docType in row.docs) {
          row.docs[a.docType] = bump(row.docs[a.docType], m.date, ref, a);
        } else if (!row && settings.requiredDocs.includes(a.docType)) {
          unassigned += 1;
        }
      }
    }
    const commonMissing = commons.filter((d) => !common[d]);
    const commonFix = commons
      .filter((d) => common[d]?.checkState === "보완 필요")
      .map((d) => ({ doc: d, note: common[d]!.fixNote ?? "" }));
    const leadIdx = Math.max(0, rows.findIndex((r) => r.institution.role === "주관기관"));
    rows.forEach((row, i) => {
      row.missing = row.required.filter((d) => !row.docs[d]);
      const own = row.required.filter((d) => row.docs[d]?.checkState === "보완 필요").map((d) => ({ doc: d, note: row.docs[d]!.fixNote ?? "" }));
      const isLead = i === leadIdx;
      row.remindDocs = isLead ? [...row.missing, ...commonMissing] : [...row.missing];
      row.fixDocs = isLead ? [...own, ...commonFix] : own;
    });
    const missingLabels = [
      ...commonMissing.map((d) => `${d}(과제 공통)`),
      ...rows.flatMap((r) => r.missing.map((d) => `${shortOrg(r.institution.name, 14)} ${d}`)),
    ];
    const totalRequired = commons.length + rows.reduce((n, r) => n + r.required.length, 0);
    const state = missingLabels.length === 0 ? "완료" : missingLabels.length >= totalRequired ? "미제출" : "일부 제출";
    return { project: p, common, commonMissing, institutions: rows, unassigned, missingLabels, lastReceived, state };
  });
}

export const STATUS_LABEL: Record<MailResult["status"], string> = {
  auto: "자동 분류",
  confirmed: "담당자 확인",
  review: "확인 필요",
  unmatched: "미분류",
  excluded: "대상 아님",
};

export { kstDateTime };
