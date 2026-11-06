"use client";
import { useState } from "react";
import type { DocScope, Settings } from "@/lib/types";

const SCOPES: DocScope[] = ["참여기관", "주관기관", "모든 기관", "과제 공통"];

export function SettingsPanel({
  settings,
  imap,
  onSave,
  onClose,
}: {
  settings: Settings;
  imap: { configured: boolean; label: string } | null;
  onSave: (s: Settings) => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const set = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="실 설정">
      <div className="composer" style={{ width: "min(720px, 100%)" }}>
        <div className="composer-head">
          <h2>실 설정</h2>
          <button className="close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        <div className="settings-body">
          <section>
            <h3>서류별 제출 대상과 기한</h3>
            <p className="hint">&apos;과제 공통&apos;은 과제당 1부만 받으면 되는 서류입니다. 빠지면 주관기관 독촉 메일에 함께 넣습니다. 기한을 넣으면 제출현황에 D-day가 표시되고 독촉 메일 기한으로 쓰입니다.</p>
            <table className="settings-table">
              <thead>
                <tr>
                  <th>서류</th>
                  <th>누가 내나</th>
                  <th>제출 기한</th>
                </tr>
              </thead>
              <tbody>
                {draft.requiredDocs.map((d) => (
                  <tr key={d}>
                    <td>{d}</td>
                    <td>
                      <select className="inline-select" value={draft.docScope[d] ?? "모든 기관"} onChange={(e) => set({ docScope: { ...draft.docScope, [d]: e.target.value as DocScope } })} aria-label={`${d} 제출 대상`}>
                        {SCOPES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="date"
                        value={draft.deadlines[d] ?? ""}
                        onChange={(e) => {
                          const next = { ...draft.deadlines };
                          if (e.target.value) next[d] = e.target.value;
                          else delete next[d];
                          set({ deadlines: next });
                        }}
                        aria-label={`${d} 제출 기한`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <h3>K-PASS 운영 중단 기간</h3>
            <p className="hint">이 기간에 메일로 받은 서류는 &apos;K-PASS 등록 대기&apos;로 표시되어, K-PASS가 다시 열리면 등록할 목록으로 모입니다.</p>
            <div className="row">
              <input type="date" value={draft.kpassWindow.from} onChange={(e) => set({ kpassWindow: { ...draft.kpassWindow, from: e.target.value } })} aria-label="중단 시작일" />
              <span>부터</span>
              <input type="date" value={draft.kpassWindow.to} onChange={(e) => set({ kpassWindow: { ...draft.kpassWindow, to: e.target.value } })} aria-label="중단 종료일" />
              <span>까지</span>
            </div>
          </section>
          <section>
            <h3>메일</h3>
            <label>
              서류를 받을 메일 주소 (안내·독촉 메일에 들어감)
              <input type="email" value={draft.submitTo} onChange={(e) => set({ submitTo: e.target.value })} placeholder="예: 실 공용 두레이 메일 주소" />
            </label>
            <label>
              수집 메일함에서 이 실이 가져올 폴더
              <input value={draft.imapFolder} onChange={(e) => set({ imapFolder: e.target.value })} placeholder="INBOX" />
              <small>{imap?.configured ? `연결된 수집 메일함: ${imap.label}. 두레이 필터로 이 실 메일을 이 폴더에 모아 두세요.` : "수집 메일함(IMAP)이 아직 연결되지 않았습니다. 연결 전에는 .eml 파일을 올려 주세요."}</small>
            </label>
          </section>
        </div>
        <div className="composer-foot">
          {err && <span className="field-err">{err}</span>}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            취소
          </button>
          <button
            className="btn primary"
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              setErr("");
              try {
                await onSave(draft);
                onClose();
              } catch (e) {
                setErr((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "저장하는 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
