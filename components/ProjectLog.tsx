"use client";
import { useMemo, useState } from "react";
import type { LedgerEvent } from "@/lib/ledger";
import type { ProjectStatusRow } from "@/lib/organize";
import { kstDateTime } from "@/lib/text";

const STATE_CLASS = { 완료: "done", "일부 제출": "part", 미제출: "none" } as const;

export function ProjectLog({
  rows,
  events,
  user,
  focus,
  onFocus,
  onMemo,
  onTransfer,
  onOpenMails,
}: {
  rows: ProjectStatusRow[];
  events: LedgerEvent[];
  user: string;
  focus: string | null;
  onFocus: (id: string) => void;
  onMemo: (projectId: string, text: string) => Promise<void>;
  onTransfer: () => void;
  onOpenMails: (projectId: string) => void;
}) {
  const [q, setQ] = useState("");
  const [mine, setMine] = useState(false);
  const [memo, setMemo] = useState("");
  const list = rows.filter(
    (r) =>
      (!mine || r.project.manager === user) &&
      (!q || `${r.project.id} ${r.project.name} ${r.project.manager} ${r.project.institutions.map((i) => i.name).join(" ")}`.toLowerCase().includes(q.toLowerCase())),
  );
  const cur = rows.find((r) => r.project.id === focus) ?? list[0];
  const evs = useMemo(() => (cur ? events.filter((e) => e.projectId === cur.project.id).slice().reverse() : []), [events, cur]);

  return (
    <div className="log-split">
      <aside className="log-list">
        <div className="log-tools">
          <input className="search" type="search" placeholder="과제번호, 과제명, 기관, 담당자" value={q} onChange={(e) => setQ(e.target.value)} aria-label="과제 찾기" />
          <label>
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> 내 과제만 ({user})
          </label>
          <button className="btn" onClick={onTransfer}>
            담당자 이관·인수인계서
          </button>
        </div>
        <ul>
          {list.map((r) => (
            <li key={r.project.id}>
              <button aria-current={cur?.project.id === r.project.id} onClick={() => onFocus(r.project.id)}>
                <span className="num">{r.project.id}</span>
                <span className={`state ${STATE_CLASS[r.state]}`}>{r.state}</span>
                <small>
                  {r.project.name}
                  {r.project.manager ? ` / ${r.project.manager}` : ""}
                </small>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {cur ? (
        <section className="log-main">
          <div className="log-head">
            <h2>
              <span className="num">{cur.project.id}</span> {cur.project.name}
            </h2>
            <button className="btn small" onClick={() => onOpenMails(cur.project.id)}>
              이 과제 메일 보기
            </button>
          </div>
          <p className="hint">
            담당 {cur.project.manager || "지정 없음"}
            {cur.project.nameEn && <> / {cur.project.nameEn}</>}
          </p>
          <table className="matrix compact">
            <thead>
              <tr>
                <th>기관</th>
                <th>받는 사람</th>
                <th>빠진 서류</th>
                <th>보완 중</th>
              </tr>
            </thead>
            <tbody>
              {cur.institutions.map((r) => (
                <tr key={r.institution.key}>
                  <td>
                    {r.institution.name} <span className={`role ${r.institution.role === "주관기관" ? "lead" : ""}`}>{r.institution.role === "주관기관" ? "주관" : "참여"}</span>
                  </td>
                  <td className="email-cell">{[r.institution.contactName, r.institution.emails.join(", ")].filter(Boolean).join(" / ")}</td>
                  <td>{r.remindDocs.join(", ") || "없음"}</td>
                  <td>{r.fixDocs.map((f) => f.doc).join(", ") || "없음"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <form
            className="memo"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!memo.trim()) return;
              await onMemo(cur.project.id, memo.trim());
              setMemo("");
            }}
          >
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="통화 내용, 해외기관 특이사항 등 다음 담당자가 알아야 할 메모" aria-label="메모" maxLength={1000} />
            <button className="btn primary" type="submit" disabled={!memo.trim()}>
              메모 남기기
            </button>
          </form>

          <h3>기록 {evs.length}건</h3>
          {evs.length ? (
            <ol className="timeline">
              {evs.map((e) => (
                <li key={e.id} className={`t-${e.type.replace(/\s/g, "")}`}>
                  <span className="t-when num">{kstDateTime(e.at)}</span>
                  <span className="t-type">{e.type}</span>
                  <span className="t-text">
                    {e.text}
                    <small> / {e.by}</small>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="hint">아직 기록이 없습니다.</p>
          )}
        </section>
      ) : (
        <section className="log-main">
          <p className="hint">과제를 골라 주세요.</p>
        </section>
      )}
    </div>
  );
}
