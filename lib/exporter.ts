import ExcelJS from "exceljs";
import JSZip from "jszip";
import { kstDateTime, planFiles, projectStatus, senderOrg, STATUS_LABEL, type PlannedFile } from "./organize";
import { logSummary, type ReminderLogEntry } from "./reminder";
import { ymd } from "./text";
import type { MailResult, ParsedMail, Project, Settings } from "./types";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } };
const OK_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F1E6" } };
const WARN_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF4D6" } };
const BAD_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFBE3E1" } };

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 28;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columnCount } };
}

function date10(iso: string) {
  return iso ? kstDateTime(iso).slice(0, 10) : "";
}

export interface ExportInput {
  mails: ParsedMail[];
  results: MailResult[];
  projects: Project[];
  settings: Settings;
  reminderLog?: ReminderLogEntry[];
}

export async function buildWorkbook(input: ExportInput, plan: PlannedFile[]): Promise<Uint8Array> {
  const { mails, results, projects, settings } = input;
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const resultById = new Map(results.map((r) => [r.mailId, r]));
  const wb = new ExcelJS.Workbook();
  wb.creator = "과제 서류 메일 정리 도우미";
  wb.created = new Date();

  // 1) 기관별 제출현황
  const status = projectStatus(mails, results, projects, settings);
  const sent = logSummary(input.reminderLog ?? []);
  const ws1 = wb.addWorksheet("기관별제출현황");
  const docCols = settings.requiredDocs.map((d) => ({
    header: `${d}\n(${settings.docScope[d] ?? "모든 기관"})`,
    key: `doc:${d}`,
    width: 14,
  }));
  ws1.columns = [
    { header: "과제번호", key: "id", width: 13 },
    { header: "과제명", key: "name", width: 36 },
    { header: "기관명", key: "org", width: 30 },
    { header: "구분", key: "role", width: 12 },
    { header: "국가", key: "country", width: 12 },
    { header: "이메일", key: "email", width: 30 },
    ...docCols,
    { header: "독촉 대상 서류", key: "remind", width: 26 },
    { header: "독촉 횟수", key: "sentCount", width: 9 },
    { header: "마지막 독촉", key: "sentLast", width: 12 },
    { header: "최근 수신일", key: "last", width: 12 },
  ];
  const firstDocCol = 7;
  for (const ps of status) {
    for (const row of ps.institutions) {
      const inst = row.institution;
      const log = sent.get(inst.key);
      const values: Record<string, string | number> = {
        id: ps.project.id,
        name: ps.project.name,
        org: inst.name,
        role: `${inst.role}${inst.foreign ? "(해외)" : ""}`,
        country: inst.country,
        email: inst.emails.join(", "),
        remind: row.remindDocs.join(", "),
        sentCount: log?.count ?? "",
        sentLast: log ? date10(log.last) : "",
        last: date10(row.lastReceived),
      };
      for (const d of settings.requiredDocs) {
        if (d in ps.common) values[`doc:${d}`] = ps.common[d] ? date10(ps.common[d]!.receivedAt) : "미제출";
        else if (row.required.includes(d)) values[`doc:${d}`] = row.docs[d] ? date10(row.docs[d]!.receivedAt) : "미제출";
        else values[`doc:${d}`] = "해당 없음";
      }
      const r = ws1.addRow(values);
      settings.requiredDocs.forEach((d, i) => {
        const cell = r.getCell(firstDocCol + i);
        cell.alignment = { horizontal: "center" };
        if (cell.value === "미제출") cell.fill = BAD_FILL;
        else if (cell.value !== "해당 없음") cell.fill = OK_FILL;
        else cell.font = { color: { argb: "FF9AA3AE" } };
      });
      if (row.remindDocs.length) r.getCell("remind").fill = WARN_FILL;
    }
  }
  styleHeader(ws1);
  ws1.getRow(1).height = 36;

  // 과제별 요약
  const wsP = wb.addWorksheet("과제별요약");
  wsP.columns = [
    { header: "과제번호", key: "id", width: 13 },
    { header: "과제명", key: "name", width: 40 },
    { header: "주관기관", key: "lead", width: 22 },
    { header: "참여기관", key: "partners", width: 36 },
    { header: "KIAT 담당자", key: "manager", width: 11 },
    { header: "상태", key: "state", width: 11 },
    { header: "빠진 서류", key: "missing", width: 48 },
    { header: "보낸 기관 미지정 서류", key: "unassigned", width: 12 },
    { header: "최근 수신일", key: "last", width: 12 },
  ];
  for (const ps of status) {
    const r = wsP.addRow({
      id: ps.project.id,
      name: ps.project.name,
      lead: ps.project.leadOrg,
      partners: ps.project.institutions.filter((i) => i.role === "참여기관").map((i) => i.name).join(", "),
      manager: ps.project.manager,
      state: ps.state,
      missing: ps.missingLabels.join(", "),
      unassigned: ps.unassigned || "",
      last: date10(ps.lastReceived),
    });
    const c = r.getCell("state");
    c.fill = ps.state === "완료" ? OK_FILL : ps.state === "일부 제출" ? WARN_FILL : BAD_FILL;
    c.alignment = { horizontal: "center" };
  }
  styleHeader(wsP);

  // 2) 메일 목록
  const ws2 = wb.addWorksheet("메일목록");
  ws2.columns = [
    { header: "번호", key: "id", width: 7 },
    { header: "수신일시", key: "date", width: 17 },
    { header: "발신자", key: "fromName", width: 18 },
    { header: "발신 메일", key: "from", width: 28 },
    { header: "보낸 기관", key: "org", width: 24 },
    { header: "제목", key: "subject", width: 44 },
    { header: "본문 요약", key: "summary", width: 60 },
    { header: "첨부 수", key: "att", width: 8 },
    { header: "과제번호", key: "pid", width: 14 },
    { header: "과제명", key: "pname", width: 36 },
    { header: "신뢰도", key: "conf", width: 8 },
    { header: "판단 근거", key: "reasons", width: 40 },
    { header: "처리 상태", key: "status", width: 12 },
    { header: "원본 파일", key: "source", width: 26 },
  ];
  for (const m of mails) {
    const r = resultById.get(m.id);
    if (!r) continue;
    const p = r.projectId ? byProject.get(r.projectId) : undefined;
    const row = ws2.addRow({
      id: m.id,
      date: kstDateTime(m.date),
      fromName: m.fromName,
      from: m.fromAddress,
      org: senderOrg(m, p?.institutions.find((i) => i.key === r.institutionKey)),
      subject: m.subject,
      summary: r.summary,
      att: m.attachments.length,
      pid: p?.id ?? "",
      pname: p?.name ?? "",
      conf: r.status === "excluded" ? "" : r.confidence,
      reasons: r.status === "excluded" ? r.relevanceReason : r.reasons.join(" / "),
      status: STATUS_LABEL[r.status] + (r.aiAssisted ? " (AI)" : ""),
      source: m.sourceName,
    });
    row.alignment = { vertical: "top", wrapText: true };
    const fill =
      r.status === "auto" || r.status === "confirmed" ? OK_FILL : r.status === "review" ? WARN_FILL : r.status === "unmatched" ? BAD_FILL : undefined;
    if (fill) row.getCell("status").fill = fill;
  }
  styleHeader(ws2);

  // 3) 첨부파일 목록
  const ws3 = wb.addWorksheet("첨부파일목록");
  ws3.columns = [
    { header: "메일 번호", key: "mail", width: 9 },
    { header: "수신일", key: "date", width: 12 },
    { header: "과제번호", key: "pid", width: 14 },
    { header: "과제명", key: "pname", width: 34 },
    { header: "서류 종류", key: "doc", width: 12 },
    { header: "원래 파일명", key: "orig", width: 40 },
    { header: "정리된 파일명", key: "std", width: 44 },
    { header: "저장 위치", key: "path", width: 60 },
    { header: "크기(KB)", key: "size", width: 10 },
    { header: "분류 근거", key: "reason", width: 30 },
  ];
  for (const f of plan) {
    if (f.attachmentIndex < 0) continue;
    const r = resultById.get(f.mailId);
    const p = f.projectId ? byProject.get(f.projectId) : undefined;
    ws3.addRow({
      mail: f.mailId,
      date: date10(f.receivedAt),
      pid: p?.id ?? "",
      pname: p?.name ?? "",
      doc: f.docType,
      orig: f.originalName,
      std: f.standardName,
      path: f.path,
      size: Math.max(1, Math.round(f.size / 1024)),
      reason: r?.attachments[f.attachmentIndex]?.docReason ?? "",
    });
  }
  styleHeader(ws3);

  // 독촉 이력
  if (input.reminderLog?.length) {
    const wsL = wb.addWorksheet("독촉이력");
    wsL.columns = [
      { header: "일시", key: "at", width: 17 },
      { header: "과제번호", key: "pid", width: 13 },
      { header: "기관명", key: "org", width: 30 },
      { header: "받는 사람", key: "to", width: 32 },
      { header: "요청 서류", key: "docs", width: 26 },
      { header: "제목", key: "subject", width: 50 },
      { header: "방식", key: "mode", width: 12 },
      { header: "결과", key: "result", width: 30 },
    ];
    for (const e of input.reminderLog) {
      wsL.addRow({
        at: kstDateTime(e.at),
        pid: e.projectId,
        org: e.institution,
        to: e.to,
        docs: e.docs.join(", "),
        subject: e.subject,
        mode: e.mode,
        result: e.ok ? "성공" : `실패: ${e.error ?? ""}`,
      });
    }
    styleHeader(wsL);
  }

  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export function exportBaseName(now = new Date()): string {
  return `과제서류정리_${ymd(now.toISOString())}`;
}

/** 정리된 폴더 구조 + 엑셀을 하나의 ZIP으로 */
export async function buildZip(input: ExportInput): Promise<{ zip: Uint8Array; plan: PlannedFile[]; excel: Uint8Array }> {
  const plan = planFiles(input.mails, input.results, input.projects);
  const excel = await buildWorkbook(input, plan);
  const base = exportBaseName();
  const zip = new JSZip();
  const root = zip.folder(base)!;
  root.file(`${base}.xlsx`, excel);
  const mailById = new Map(input.mails.map((m) => [m.id, m]));
  for (const f of plan) {
    const m = mailById.get(f.mailId)!;
    const bytes = f.attachmentIndex < 0 ? m.raw : m.attachments[f.attachmentIndex].content;
    root.file(f.path, bytes, { date: m.date ? new Date(m.date) : undefined });
  }
  const out = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { zip: out, plan, excel };
}
