"use client";
import { useMemo, useState } from "react";
import type { DocState, InstitutionStatusRow, ProjectStatusRow } from "@/lib/organize";
import { kstDateTime } from "@/lib/text";
import type { DocScope, Settings } from "@/lib/types";

const STATE_CLASS = { 완료: "done", "일부 제출": "part", 미제출: "none" } as const;
const SCOPES: DocScope[] = ["참여기관", "주관기관", "모든 기관", "과제 공통"];

function Stamp({ v, label }: { v: DocState | null | undefined; label: string }) {
  if (!v) return <span className="stamp-empty">미제출</span>;
  return (
    <span className="stamp" title={`${label} ${v.count}건, 마지막 ${kstDateTime(v.receivedAt)}`}>
      <span>
        접수
        <b>{kstDateTime(v.receivedAt).slice(5, 10).replace("-", ".")}</b>
      </span>
    </span>
  );
}

export function canRemind(r: InstitutionStatusRow) {
  return r.remindDocs.length > 0 && r.institution.emails.length > 0;
}

export function StatusMatrix({
  rows,
  settings,
  onScopeChange,
  sent,
  selected,
  onSelect,
  onOpenProject,
  onCompose,
}: {
  rows: ProjectStatusRow[];
  settings: Settings;
  onScopeChange: (doc: string, scope: DocScope) => void;
  sent: Map<string, { count: number; last: string }>;
  selected: Set<string>;
  onSelect: (keys: string[], on: boolean) => void;
  onOpenProject: (id: string) => void;
  onCompose: () => void;
}) {
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [showScope, setShowScope] = useState(false);
  const docs = settings.requiredDocs;

  const allInst = useMemo(() => rows.flatMap((r) => r.institutions), [rows]);
  const missingInst = allInst.filter((r) => r.remindDocs.length > 0);
  const remindable = missingInst.filter(canRemind);
  const noMail = missingInst.length - remindable.length;
  const shown = onlyMissing
    ? rows
        .filter((p) => p.missingLabels.length > 0)
        .map((p) => ({ ...p, institutions: p.institutions.filter((i) => i.remindDocs.length > 0) }))
    : rows;
  const shownKeys = shown.flatMap((p) => p.institutions.filter(canRemind).map((i) => i.institution.key));
  const allShownSelected = shownKeys.length > 0 && shownKeys.every((k) => selected.has(k));

  return (
    <>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
          기관 {allInst.length}곳 중 <b style={{ color: missingInst.length ? "var(--bad)" : "var(--ok)" }}>{missingInst.length}곳</b>이
          아직 서류를 다 내지 않았습니다.
          {noMail > 0 && <span style={{ color: "var(--warn)" }}> (이메일이 없는 기관 {noMail}곳은 독촉 메일을 보낼 수 없습니다)</span>}
        </span>
        <span className="spacer" />
        <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          미제출 기관만
        </label>
        <button className="btn" onClick={() => setShowScope((v) => !v)} aria-expanded={showScope}>
          서류별 제출 대상
        </button>
        <button className="btn primary" disabled={selected.size === 0} onClick={onCompose}>
          선택한 {selected.size}곳에 독촉 메일 쓰기
        </button>
      </div>

      {showScope && (
        <div className="scope-panel">
          <p>서류마다 누가 내야 하는지 정합니다. &apos;과제 공통&apos;은 과제당 1부만 받으면 되는 서류이며, 빠지면 주관기관 독촉 메일에 함께 넣습니다.</p>
          <div className="scope-grid">
            {docs.map((d) => (
              <label key={d}>
                <span>{d}</span>
                <select className="inline-select" value={settings.docScope[d] ?? "모든 기관"} onChange={(e) => onScopeChange(d, e.target.value as DocScope)}>
                  {SCOPES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input
                  type="checkbox"
                  aria-label="보이는 미제출 기관 모두 선택"
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
                  <small>{settings.docScope[d] ?? "모든 기관"}</small>
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
                  {p.unassigned > 0 && <span className="sub-note">보낸 기관을 모르는 서류 {p.unassigned}건</span>}
                </td>
                {docs.map((d) => (
                  <td key={d} className="doc">
                    {d in p.common ? <Stamp v={p.common[d]} label={d} /> : null}
                  </td>
                ))}
                <td>
                  <button className="btn small" onClick={() => onOpenProject(p.project.id)}>
                    메일 보기
                  </button>
                </td>
              </tr>
              {p.institutions.map((r) => {
                const inst = r.institution;
                const s = sent.get(inst.key);
                const ok = canRemind(r);
                return (
                  <tr key={inst.key} className="inst-row">
                    <td>
                      {r.remindDocs.length > 0 && (
                        <input
                          type="checkbox"
                          aria-label={`${inst.name} 선택`}
                          disabled={!ok}
                          checked={selected.has(inst.key)}
                          onChange={(e) => onSelect([inst.key], e.target.checked)}
                        />
                      )}
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
                          <Stamp v={r.docs[d]} label={d} />
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
            <p>미제출 기관이 없습니다. 모든 서류를 받았습니다.</p>
          </div>
        )}
      </div>
    </>
  );
}
