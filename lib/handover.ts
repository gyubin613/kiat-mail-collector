// 담당자 인수인계서 (인쇄·PDF 저장용 HTML)
import { contactSummary, ddayLabel, daysLeft, type LedgerEvent } from "./ledger";
import type { ProjectStatusRow } from "./organize";
import { kstDateTime } from "./text";
import type { Settings } from "./types";

const esc = (s: string) => (s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export interface HandoverInput {
  deptName: string;
  from: string;
  to: string;
  by: string;
  rows: ProjectStatusRow[];
  events: LedgerEvent[];
  settings: Settings;
  kpassWaiting: Map<string, number>;
  now?: Date;
}

export function nextActions(row: ProjectStatusRow, settings: Settings, kpassWaiting: number, now = new Date()): string[] {
  const out: string[] = [];
  for (const r of row.institutions) {
    if (r.remindDocs.length) {
      const dl = r.remindDocs.map((d) => settings.deadlines[d]).filter(Boolean).sort()[0];
      out.push(`${r.institution.name}: ${r.remindDocs.join(", ")} 미제출${dl ? ` (기한 ${dl}, ${ddayLabel(daysLeft(dl, now))})` : ""}`);
    }
    if (r.fixDocs.length) out.push(`${r.institution.name}: ${r.fixDocs.map((f) => f.doc).join(", ")} 보완 요청 중, 다시 받은 서류 확인`);
  }
  if (kpassWaiting) out.push(`K-PASS 등록 대기 서류 ${kpassWaiting}건 등록`);
  if (row.unassigned) out.push(`보낸 기관을 모르는 서류 ${row.unassigned}건 정리`);
  return out;
}

export function buildHandoverHtml(input: HandoverInput): string {
  const now = input.now ?? new Date();
  const reminded = contactSummary(input.events, "독촉");
  const sections = input.rows.map((row) => {
    const p = row.project;
    const evs = input.events.filter((e) => e.projectId === p.id).slice(-8).reverse();
    const actions = nextActions(row, input.settings, input.kpassWaiting.get(p.id) ?? 0, now);
    return `
<section>
  <h2>${esc(p.id)} ${esc(p.name)}</h2>
  <p class="meta">상태: <b>${esc(row.state)}</b>${p.year ? ` / 연도 ${esc(p.year)}` : ""}${row.lastReceived ? ` / 최근 수신 ${esc(kstDateTime(row.lastReceived).slice(0, 10))}` : ""}</p>
  <table>
    <thead><tr><th>기관</th><th>구분</th><th>받는 사람</th><th>빠진 서류</th><th>보완 중</th><th>독촉</th></tr></thead>
    <tbody>
      ${row.institutions
        .map((r) => {
          const s = reminded.get(r.institution.key);
          return `<tr><td>${esc(r.institution.name)}</td><td>${esc(r.institution.role)}${r.institution.foreign ? "(해외)" : ""}</td><td>${esc(
            [r.institution.contactName, r.institution.emails.join(", ")].filter(Boolean).join(" / "),
          )}</td><td>${esc(r.remindDocs.join(", ") || "없음")}</td><td>${esc(r.fixDocs.map((f) => `${f.doc}(${f.note || "확인 필요"})`).join(", ") || "없음")}</td><td>${
            s ? `${s.count}회, 마지막 ${esc(kstDateTime(s.last).slice(0, 10))}` : "없음"
          }</td></tr>`;
        })
        .join("")}
    </tbody>
  </table>
  <h3>다음에 할 일</h3>
  ${actions.length ? `<ul>${actions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>` : "<p>남은 일이 없습니다.</p>"}
  <h3>최근 기록</h3>
  ${
    evs.length
      ? `<ul class="log">${evs.map((e) => `<li><span>${esc(kstDateTime(e.at))}</span> ${esc(e.by)}: ${esc(e.text)}</li>`).join("")}</ul>`
      : "<p>기록이 없습니다.</p>"
  }
</section>`;
  });
  const todo = input.rows.filter((r) => r.state !== "완료").length;
  return `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>인수인계서 ${esc(input.from)} → ${esc(input.to)}</title>
<style>
body{font-family:"IBM Plex Sans KR","Malgun Gothic","Apple SD Gothic Neo",sans-serif;color:#1c2430;max-width:960px;margin:32px auto;padding:0 24px;line-height:1.55;font-size:14px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 4px;padding-top:16px;border-top:2px solid #1f3a5f}h3{font-size:13.5px;margin:14px 0 6px;color:#4a5566}
.meta{color:#4a5566;margin:0 0 8px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #dde2e8;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f6f7f4;font-weight:600}
ul{margin:4px 0;padding-left:20px}.log li span{color:#7d8796;font-variant-numeric:tabular-nums}.head{display:grid;grid-template-columns:110px 1fr;gap:2px 12px;margin:12px 0 20px}.head dt{color:#7d8796}.head dd{margin:0}
.print{position:fixed;top:16px;right:16px;padding:8px 14px;border:1px solid #1f3a5f;background:#1f3a5f;color:#fff;border-radius:4px;cursor:pointer;font:inherit}
@media print{.print{display:none}body{margin:0}h2{break-before:auto}section{break-inside:avoid-page}}
</style></head><body>
<button class="print" onclick="window.print()">인쇄·PDF 저장</button>
<h1>과제 서류 인수인계서</h1>
<dl class="head">
<dt>부서</dt><dd>${esc(input.deptName)}</dd>
<dt>인계자</dt><dd>${esc(input.from || "(지정 없음)")}</dd>
<dt>인수자</dt><dd>${esc(input.to)}</dd>
<dt>작성</dt><dd>${esc(kstDateTime(now.toISOString()))} / ${esc(input.by)} (과제 서류 메일 정리 도우미에서 자동 작성)</dd>
<dt>과제</dt><dd>${input.rows.length}개 (서류가 남은 과제 ${todo}개)</dd>
</dl>
${sections.join("\n")}
</body></html>`;
}
