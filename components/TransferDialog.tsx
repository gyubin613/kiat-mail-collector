"use client";
import { useMemo, useState } from "react";
import type { Project } from "@/lib/types";

export function TransferDialog({
  projects,
  user,
  onTransfer,
  onPreview,
  onClose,
}: {
  projects: Project[];
  user: string;
  onTransfer: (from: string, to: string, ids: string[]) => Promise<void>;
  onPreview: (from: string, to: string, ids: string[]) => void;
  onClose: () => void;
}) {
  const managers = useMemo(() => [...new Set(projects.map((p) => p.manager).filter(Boolean))].sort(), [projects]);
  const [from, setFrom] = useState(managers.includes(user) ? user : managers[0] ?? "");
  const [to, setTo] = useState("");
  const mine = projects.filter((p) => p.manager === from);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(mine.map((p) => p.id)));
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ids = mine.filter((p) => picked.has(p.id)).map((p) => p.id);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="담당자 이관">
      <div className="composer" style={{ width: "min(680px, 100%)" }}>
        <div className="composer-head">
          <h2>담당자 이관과 인수인계서</h2>
          <button className="close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="settings-body">
          <p className="hint">과제의 담당자를 바꾸고, 과제별 남은 서류·보완 중인 서류·연락처·최근 기록을 담은 인수인계서를 만듭니다. 이관 기록은 과제 기록에 남습니다.</p>
          <div className="row">
            <label>
              지금 담당자
              <select
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  setPicked(new Set(projects.filter((p) => p.manager === e.target.value).map((p) => p.id)));
                }}
              >
                {managers.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
            <label>
              새 담당자
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="예: 이OO" maxLength={40} />
            </label>
          </div>
          <h3>넘길 과제 {ids.length} / {mine.length}개</h3>
          <ul className="pick-list">
            {mine.map((p) => (
              <li key={p.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={picked.has(p.id)}
                    onChange={(e) =>
                      setPicked((cur) => {
                        const n = new Set(cur);
                        if (e.target.checked) n.add(p.id);
                        else n.delete(p.id);
                        return n;
                      })
                    }
                  />
                  <span className="num">{p.id}</span> {p.name}
                </label>
              </li>
            ))}
          </ul>
        </div>
        <div className="composer-foot">
          {err && <span className="field-err">{err}</span>}
          <span className="spacer" />
          <button className="btn" disabled={!ids.length} onClick={() => onPreview(from, to.trim() || "(미정)", ids)}>
            인수인계서만 보기
          </button>
          <button
            className="btn primary"
            disabled={busy || !ids.length || !to.trim() || to.trim() === from}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                await onTransfer(from, to.trim(), ids);
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "이관하는 중…" : `${ids.length}개 과제 이관하고 인수인계서 열기`}
          </button>
        </div>
      </div>
    </div>
  );
}
