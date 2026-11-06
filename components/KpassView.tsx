"use client";
import { useMemo, useState } from "react";
import type { KpassItem } from "@/lib/ledger";
import { kstDateTime } from "@/lib/text";
import type { Project } from "@/lib/types";

export function KpassView({
  items,
  projectsById,
  window,
  onMark,
  onExport,
  onOpenSettings,
}: {
  items: KpassItem[];
  projectsById: Map<string, Project>;
  window: { from: string; to: string };
  onMark: (refs: string[], state: "등록 대기" | "등록 완료") => void;
  onExport: (refs: string[]) => void;
  onOpenSettings: () => void;
}) {
  const [show, setShow] = useState<"등록 대기" | "등록 완료" | "전체">("등록 대기");
  const [onlyLatest, setOnlyLatest] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const shown = useMemo(
    () => items.filter((i) => (show === "전체" || i.state === show) && (!onlyLatest || i.latest)),
    [items, show, onlyLatest],
  );
  const waiting = items.filter((i) => i.state === "등록 대기" && i.latest).length;
  const pickedShown = shown.filter((i) => picked.has(i.ref)).map((i) => i.ref);
  const allPicked = shown.length > 0 && shown.every((i) => picked.has(i.ref));
  const toggle = (refs: string[], on: boolean) =>
    setPicked((cur) => {
      const n = new Set(cur);
      for (const r of refs) {
        if (on) n.add(r);
        else n.delete(r);
      }
      return n;
    });

  if (!window.from || !window.to) {
    return (
      <div className="empty">
        <p>K-PASS 운영 중단 기간이 설정되지 않았습니다.</p>
        <p style={{ fontSize: 13 }}>기간을 넣으면 그 기간에 메일로 받은 서류가 이곳에 &apos;등록 대기&apos;로 모입니다.</p>
        <button className="btn primary" onClick={onOpenSettings}>
          기간 설정하기
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="toolbar" style={{ marginTop: 4 }}>
        <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
          중단 기간 {window.from} ~ {window.to}에 받은 서류 중 K-PASS 등록 대기 <b style={{ color: waiting ? "var(--warn)" : "var(--ok)" }}>{waiting}건</b>
        </span>
        <span className="spacer" />
        <label style={{ fontSize: 13.5, display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={onlyLatest} onChange={(e) => setOnlyLatest(e.target.checked)} />
          최근 제출본만 (예전 차수·중복 제외)
        </label>
        <div className="views" role="group" aria-label="상태">
          {(["등록 대기", "등록 완료", "전체"] as const).map((s) => (
            <button key={s} aria-pressed={show === s} onClick={() => setShow(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar compose-bar">
        <span>선택한 {pickedShown.length}건을</span>
        <button className="btn primary" disabled={!pickedShown.length} onClick={() => (onMark(pickedShown, "등록 완료"), setPicked(new Set()))}>
          K-PASS 등록 완료로 표시
        </button>
        <button className="btn" disabled={!pickedShown.length} onClick={() => (onMark(pickedShown, "등록 대기"), setPicked(new Set()))}>
          등록 대기로 되돌리기
        </button>
        <button className="btn" disabled={!shown.length} onClick={() => onExport(pickedShown.length ? pickedShown : shown.map((i) => i.ref))}>
          {pickedShown.length ? "선택한 파일" : "보이는 파일"} 모아 받기 (ZIP)
        </button>
      </div>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th style={{ width: 36 }}>
                <input type="checkbox" aria-label="모두 선택" checked={allPicked} disabled={!shown.length} onChange={(e) => toggle(shown.map((i) => i.ref), e.target.checked)} />
              </th>
              <th>과제</th>
              <th>보낸 기관</th>
              <th>서류</th>
              <th>파일</th>
              <th>받은 날</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((i) => {
              const p = projectsById.get(i.projectId);
              const inst = p?.institutions.find((x) => x.key === i.institutionKey);
              return (
                <tr key={i.ref}>
                  <td>
                    <input type="checkbox" aria-label={`${i.filename} 선택`} checked={picked.has(i.ref)} onChange={(e) => toggle([i.ref], e.target.checked)} />
                  </td>
                  <td>
                    <span className="num" style={{ fontWeight: 500 }}>
                      {i.projectId}
                    </span>
                    <small className="cell-sub">{p?.name}</small>
                  </td>
                  <td>{inst?.name ?? <span style={{ color: "var(--ink-faint)" }}>알 수 없음</span>}</td>
                  <td>
                    {i.docType}
                    {!i.latest && <small className="cell-sub">예전 차수</small>}
                  </td>
                  <td className="email-cell">{i.filename}</td>
                  <td className="num">{kstDateTime(i.receivedAt).slice(0, 10)}</td>
                  <td>
                    <span className={`state ${i.state === "등록 완료" ? "done" : "part"}`}>{i.state}</span>
                    {i.doneAt && (
                      <small className="cell-sub">
                        {kstDateTime(i.doneAt).slice(5, 10).replace("-", ".")} {i.doneBy}
                      </small>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && (
          <div className="empty" style={{ border: "none" }}>
            <p>{show === "등록 대기" ? "등록할 서류가 없습니다." : "해당하는 서류가 없습니다."}</p>
          </div>
        )}
      </div>
    </>
  );
}
