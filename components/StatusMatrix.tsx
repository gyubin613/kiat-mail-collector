"use client";
import { useMemo, useState } from "react";
import { daysLeft, ddayLabel, type VersionInfo } from "@/lib/ledger";
import type { DocState, InstitutionStatusRow, ProjectStatusRow } from "@/lib/organize";
import { eligible, type MailKind } from "@/lib/reminder";
import { kstDateTime } from "@/lib/text";
import type { Settings } from "@/lib/types";

const STATE_CLASS = { 완료: "done", "일부 제출": "part", 미제출: "none" } as const;
const KINDS: MailKind[] = ["독촉", "보완 요청", "접수 확인"];

function Stamp({ v, label, versions }: { v: DocState | null | undefined; label: string; versions: Map<string, VersionInfo> }) {
  if (!v) return null;
  const ver = v.latestRef ? versions.get(v.latestRef)?.version ?? 1 : 1;
  const date = kstDateTime(v.receivedAt).slice(5, 10).replace("-", ".");
  const fix = v.checkState === "보완 필요";
  const check = !fix && v.checkState === "미점검" && v.autoSuggestion === "fix";
  const title = `${label}: ${ver > 1 ? `${ver}차 제출, ` : ""}마지막 ${kstDateTime(v.receivedAt)}${fix ? `, 보완 필요${v.fixNote ? ` (${v.fixNote})` : ""}` : check ? ", 자동 점검에서 보완이 필요해 보임" : v.checkState === "이상 없음" ? ", 점검 완료" : ""}`;
  return (
    <span className={`stamp${fix ? " fix" : check ? " check" : ""}`} title={title}>
      <span>
        {fix ? "보완" : check ? "점검" : "접수"}
        <b>{date}</b>
        {ver > 1 && <i>{ver}차</i>}
      </span>
    </span>
  );
}

function Missing({ deadline }: { deadline?: string }) {
  const n = deadline ? daysLeft(deadline) : null;
  return (
    <span className={`stamp-empty${n !== null && n < 0 ? " late" : n !== null && n <= 3 ? " soon" : ""}`} title={deadline ? `기한 ${deadline}` : "기한 없음"}>
      <span>
        미제출
        {n !== null && <b>{ddayLabel(n)}</b>}
      </span>
    </span>
  );
}

export function StatusMatrix({
  rows,
  settings,
  versions,
  sent,
  selected,
  onSelect,
  onOpenProject,
  onCompose,
  onOpenSettings,
}: {
  rows: ProjectStatusRow[];
  settings: Settings;
  versions: Map<string, VersionInfo>;
  sent: Map<string, { count: number; last: string }>;
  selected: Set<string>;
  onSelect: (keys: string[], on: boolean) => void;
  onOpenProject: (id: string) => void;
  onCompose: (kind: MailKind) => void;
  onOpenSettings: () => void;
}) {
  const [show, setShow] = useState<"todo" | "all">("todo");
  const docs = settings.requiredDocs;

  const allInst = useMemo(() => rows.flatMap((r) => r.institutions), [rows]);
  const missingInst = allInst.filter((r) => r.remindDocs.length > 0);
  const fixInst = allInst.filter((r) => r.fixDocs.length > 0);
  const todo = (r: InstitutionStatusRow) => r.remindDocs.length > 0 || r.fixDocs.length > 0;
  const shown =
    show === "todo"
      ? rows
          .filter((p) => p.institutions.some(todo) || p.unassigned > 0)
          .map((p) => ({ ...p, institutions: p.institutions.filter(todo) }))
      : rows;
  const shownKeys = shown.flatMap((p) => p.institutions.filter((i) => i.institution.emails.length).map((i) => i.institution.key));
  const allShownSelected = shownKeys.length > 0 && shownKeys.every((k) => selected.has(k));
  const selectedRows = allInst.filter((r) => selected.has(r.institution.key));
  const countFor = (k: MailKind) => selectedRows.filter((r) => eligible(k, r)).length;

  return (
    <>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
          기관 {allInst.length}곳 중 미제출 <b style={{ color: missingInst.length ? "var(--bad)" : "var(--ok)" }}>{missingInst.length}곳</b>, 보완 요청{" "}
          <b style={{ color: fixInst.length ? "var(--warn)" : "var(--ink)" }}>{fixInst.length}곳</b>
        </span>
        <span className="spacer" />
        <div className="views" role="group" aria-label="보기">
          <button aria-pressed={show === "todo"} onClick={() => setShow("todo")}>
            할 일 있는 기관
          </button>
          <button aria-pressed={show === "all"} onClick={() => setShow("all")}>
            전체
          </button>
        </div>
        <button className="btn" onClick={onOpenSettings}>
          서류·기한 설정
        </button>
      </div>

      <div className="toolbar compose-bar">
        <span>선택한 기관 {selected.size}곳에</span>
        {KINDS.map((k) => (
          <button key={k} className={`btn${k === "독촉" ? " primary" : ""}`} disabled={countFor(k) === 0} onClick={() => onCompose(k)}>
            {k} 메일 ({countFor(k)})
          </button>
        ))}
      </div>

      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="보이는 기관 모두 선택"
                  checked={allShownSelected}
                  disabled={!shownKeys.length}
                  onChange={(e) => onSelect(shownKeys, e.target.checked)}
                />
              </th>
              <th>과제 / 기관</th>
              <th>구분</th>
              <th>이메일</th>
              {docs.map((d) => (
                <th key={d} className="doc">
                  {d}
                  <small>
                    {settings.docScope[d] ?? "모든 기관"}
                    {settings.deadlines[d] ? `, ~${settings.deadlines[d].slice(5).replace("-", ".")}` : ""}
                  </small>
                </th>
              ))}
              <th>독촉</th>
            </tr>
          </thead>
          {shown.map((p) => (
            <tbody key={p.project.id} className="proj-group">
              <tr className="proj-row">
                <td />
                <td colSpan={3}>
                  <span className="num" style={{ fontWeight: 600 }}>
                    {p.project.id}
                  </span>{" "}
                  {p.project.name}
                  <span className={`state ${STATE_CLASS[p.state]}`} style={{ marginLeft: 8 }}>
                    {p.state}
                  </span>
                  {p.project.manager && <span className="mgr">담당 {p.project.manager}</span>}
                  {p.unassigned > 0 && <span className="sub-note">보낸 기관을 모르는 서류 {p.unassigned}건</span>}
                </td>
                {docs.map((d) => (
                  <td key={d} className="doc">
                    {d in p.common ? p.common[d] ? <Stamp v={p.common[d]} label={d} versions={versions} /> : <Missing deadline={settings.deadlines[d]} /> : null}
                  </td>
                ))}
                <td>
                  <button className="btn small" onClick={() => onOpenProject(p.project.id)}>
                    기록 보기
                  </button>
                </td>
              </tr>
              {p.institutions.map((r) => {
                const inst = r.institution;
                const s = sent.get(inst.key);
                return (
                  <tr key={inst.key} className="inst-row">
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`${inst.name} 선택`}
                        disabled={!inst.emails.length}
                        checked={selected.has(inst.key)}
                        onChange={(e) => onSelect([inst.key], e.target.checked)}
                      />
                    </td>
                    <td className="inst-name">
                      {inst.name}
                      {inst.contactName && <small>{inst.contactName}</small>}
                    </td>
                    <td>
                      <span className={`role ${inst.role === "주관기관" ? "lead" : ""}`}>{inst.role === "주관기관" ? "주관" : "참여"}</span>
                      {inst.foreign && <span className="role foreign">해외{inst.country ? ` (${inst.country})` : ""}</span>}
                    </td>
                    <td className="email-cell">{inst.emails.join(", ") || <span style={{ color: "var(--warn)" }}>없음</span>}</td>
                    {docs.map((d) => (
                      <td key={d} className="doc">
                        {d in p.common ? (
                          <span className="na" title="과제 공통 서류">
                            공통
                          </span>
                        ) : r.required.includes(d) ? (
                          r.docs[d] ? (
                            <Stamp v={r.docs[d]} label={d} versions={versions} />
                          ) : (
                            <Missing deadline={settings.deadlines[d]} />
                          )
                        ) : (
                          <span className="na">해당 없음</span>
                        )}
                      </td>
                    ))}
                    <td className="num" style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                      {s ? `${kstDateTime(s.last).slice(5, 10).replace("-", ".")} (${s.count}회)` : <span style={{ color: "var(--ink-faint)" }}>없음</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
        {!shown.length && (
          <div className="empty" style={{ border: "none" }}>
            <p>할 일이 있는 기관이 없습니다. 모든 서류를 받았고 보완 요청도 없습니다.</p>
          </div>
        )}
      </div>
    </>
  );
}
