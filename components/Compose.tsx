"use client";
import { useEffect, useMemo, useState } from "react";
import type { InstitutionStatusRow } from "@/lib/organize";
import {
  buildMessage,
  mailtoHref,
  parseRecipients,
  type Lang,
  type MailKind,
  type ReminderDraft,
  type ReminderLogEntry,
  type ReminderOptions,
} from "@/lib/reminder";
import type { Settings } from "@/lib/types";

export interface MailStatus {
  enabled: boolean;
  from: string;
  allowAll: boolean;
  allowedHint: string;
}

const SIG_KEY = "kmc-signature-v1";

function plusDays(n: number) {
  return new Date(Date.now() + 9 * 3600 * 1000 + n * 86400 * 1000).toISOString().slice(0, 10);
}

function initialOptions(kind: MailKind, rows: InstitutionStatusRow[], settings: Settings, dept: string, user: string): ReminderOptions {
  const docs = [...new Set(rows.flatMap((r) => (kind === "독촉" ? r.remindDocs : kind === "보완 요청" ? r.fixDocs.map((f) => f.doc) : r.remindDocs)))];
  const today = plusDays(0);
  const set = docs.map((d) => settings.deadlines[d]).filter((d): d is string => !!d && d >= today).sort();
  let signature = `한국산업기술진흥원 ${dept}\n담당자 ${user}`;
  try {
    signature = localStorage.getItem(SIG_KEY) || signature;
  } catch {
    /* 무시 */
  }
  return {
    deadline: set[0] ?? plusDays(kind === "보완 요청" ? 5 : 7),
    submitTo: settings.submitTo,
    signature,
    kpassClosed: !!(settings.kpassWindow.from && settings.kpassWindow.to && today >= settings.kpassWindow.from && today <= settings.kpassWindow.to),
  };
}

export function Compose({
  kind,
  rows,
  sent,
  mail,
  settings,
  dept,
  user,
  onClose,
  onLogged,
  onRemove,
}: {
  kind: MailKind;
  rows: InstitutionStatusRow[];
  sent: Map<string, { count: number; last: string }>;
  mail: MailStatus | null;
  settings: Settings;
  dept: string;
  user: string;
  onClose: () => void;
  onLogged: (entries: ReminderLogEntry[]) => void;
  onRemove: (key: string) => void;
}) {
  const [opts, setOpts] = useState<ReminderOptions>(() => initialOptions(kind, rows, settings, dept, user));
  const [langs, setLangs] = useState<Record<string, Lang>>({});
  const [drafts, setDrafts] = useState<Record<string, ReminderDraft>>({});
  const [testTo, setTestTo] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string; real?: boolean }>>({});
  // 창을 연 시점의 독촉 이력 기준으로 초안을 만든다 (보내자마자 제목이 '재안내'로 바뀌지 않도록)
  const [sentAtOpen] = useState(sent);

  useEffect(() => {
    try {
      localStorage.setItem(SIG_KEY, opts.signature);
    } catch {
      /* 무시 */
    }
  }, [opts.signature]);

  // 설정이 바뀌면 고치지 않은 초안만 새로 만든다
  useEffect(() => {
    setDrafts((prev) => {
      const next: Record<string, ReminderDraft> = {};
      for (const r of rows) {
        const k = r.institution.key;
        const old = prev[k];
        const lang = langs[k];
        if (old?.edited && (!lang || lang === old.lang)) next[k] = old;
        else next[k] = buildMessage(kind, r, opts, lang, sentAtOpen.get(k)?.count ?? 0);
      }
      return next;
    });
  }, [rows, opts, langs, sentAtOpen]);

  const list = useMemo(() => rows.map((r) => drafts[r.institution.key]).filter(Boolean), [rows, drafts]);
  const edit = (k: string, patch: Partial<ReminderDraft>) =>
    setDrafts((d) => ({ ...d, [k]: { ...d[k], ...patch, edited: true } }));

  const canSend = !!mail?.enabled;
  const invalid = list.filter((d) => parseRecipients(d.to).ok.length === 0 || parseRecipients(d.to).bad.length > 0);
  const missingSubmitTo = kind !== "접수 확인" && !opts.submitTo.trim();

  const send = async (targets: ReminderDraft[], test: boolean) => {
    setSending(true);
    setConfirming(false);
    try {
      const res = await fetch("/api/mail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          testTo: test ? testTo : undefined,
          messages: targets.map((d) => ({ id: d.key, to: parseRecipients(d.to).ok, subject: d.subject, body: d.body })),
        }),
      });
      const data = (await res.json()) as { results?: { id: string; ok: boolean; sentTo: string[]; error?: string }[]; error?: string };
      if (!res.ok || !data.results) throw new Error(data.error || `오류 ${res.status}`);
      const now = new Date().toISOString();
      const entries: ReminderLogEntry[] = data.results.map((r) => {
        const d = targets.find((t) => t.key === r.id)!;
        return {
          kind,
          key: d.key,
          projectId: d.projectId,
          institution: d.institution,
          to: r.sentTo.join(", "),
          subject: d.subject,
          docs: d.docs,
          at: now,
          mode: test ? "시험 발송" : "발송",
          ok: r.ok,
          error: r.error,
        };
      });
      onLogged(entries);
      setResults((cur) => {
        const n = { ...cur };
        for (const r of data.results!) {
          if (test && n[r.id]?.real) continue;
          n[r.id] = { ok: r.ok, real: !test && r.ok, text: r.ok ? `${test ? "시험 발송" : "발송"} 완료 (${r.sentTo.join(", ")})` : `보내지 못함: ${r.error}` };
        }
        return n;
      });
    } catch (e) {
      const msg = (e as Error).message;
      setResults((cur) => {
        const n = { ...cur };
        for (const d of targets) if (!n[d.key]?.real) n[d.key] = { ok: false, text: `보내지 못함: ${msg}` };
        return n;
      });
    } finally {
      setSending(false);
    }
  };

  const openMailApp = (d: ReminderDraft) => {
    onLogged([
      {
        kind,
        key: d.key,
        projectId: d.projectId,
        institution: d.institution,
        to: parseRecipients(d.to).ok.join(", "),
        subject: d.subject,
        docs: d.docs,
        at: new Date().toISOString(),
        mode: "메일 프로그램",
        ok: true,
      },
    ]);
    setResults((cur) => ({ ...cur, [d.key]: { ok: true, real: true, text: "메일 프로그램에서 열었습니다. 독촉 1회로 기록했습니다." } }));
  };

  const pending = list.filter((d) => !results[d.key]?.real);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={`${kind} 메일 쓰기`}>
      <div className="composer">
        <div className="composer-head">
          <h2>
            {kind} 메일 {list.length}통
          </h2>
          <button className="close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="composer-opts">
          <label>
            {kind === "보완 요청" ? "다시 제출할 기한" : "제출 기한"}
            <input type="date" value={opts.deadline} onChange={(e) => setOpts({ ...opts, deadline: e.target.value })} />
          </label>
          <label className="grow">
            서류를 받을 메일 주소
            <input
              type="email"
              placeholder="예: 담당자 두레이 메일 주소"
              value={opts.submitTo}
              onChange={(e) => setOpts({ ...opts, submitTo: e.target.value })}
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={opts.kpassClosed} onChange={(e) => setOpts({ ...opts, kpassClosed: e.target.checked })} />
            K-PASS 운영 중단 안내 넣기
          </label>
          <label className="grow">
            서명
            <textarea rows={2} value={opts.signature} onChange={(e) => setOpts({ ...opts, signature: e.target.value })} />
          </label>
        </div>

        <div className="send-state">
          {canSend ? (
            <>
              보내는 주소 <b>{mail!.from}</b>
              {!mail!.allowAll && <> / 보낼 수 있는 받는 주소: {mail!.allowedHint} (허용 목록에 없는 주소는 막힙니다)</>}
            </>
          ) : (
            <>메일 발송 설정이 없어 &apos;메일 프로그램으로 열기&apos;와 &apos;복사&apos;만 쓸 수 있습니다.</>
          )}
        </div>

        <div className="drafts">
          {list.map((d) => {
            const prev = sentAtOpen.get(d.key);
            const rcpt = parseRecipients(d.to);
            const res = results[d.key];
            return (
              <section className="draft" key={d.key}>
                <div className="draft-head">
                  <div>
                    <b>{d.institution}</b> <span className="num sub">{d.projectId}</span>
                    <div className="sub">
                      {kind === "접수 확인" ? "받은 서류" : kind === "보완 요청" ? "보완 요청 서류" : "요청 서류"}: {d.docs.join(", ")}
                      {kind === "독촉" && prev && ` / 이전 독촉 ${prev.count}회`}
                    </div>
                  </div>
                  <div className="lang" role="group" aria-label="언어">
                    {(["ko", "en"] as Lang[]).map((l) => (
                      <button
                        key={l}
                        aria-pressed={d.lang === l}
                        onClick={() => setLangs((x) => ({ ...x, [d.key]: l }))}
                      >
                        {l === "ko" ? "국문" : "영문"}
                      </button>
                    ))}
                  </div>
                </div>
                <label>
                  받는 사람
                  <input value={d.to} onChange={(e) => edit(d.key, { to: e.target.value })} aria-invalid={rcpt.bad.length > 0 || !rcpt.ok.length} />
                </label>
                {(rcpt.bad.length > 0 || !rcpt.ok.length) && <div className="field-err">메일 주소 형식을 확인해 주세요.</div>}
                <label>
                  제목
                  <input value={d.subject} onChange={(e) => edit(d.key, { subject: e.target.value })} />
                </label>
                <label>
                  본문
                  <textarea rows={11} value={d.body} onChange={(e) => edit(d.key, { body: e.target.value })} />
                </label>
                <div className="actions">
                  {canSend && (
                    <button className="btn small" disabled={sending || !rcpt.ok.length || rcpt.bad.length > 0 || !!res?.real} onClick={() => send([d], false)}>
                      이 메일 보내기
                    </button>
                  )}
                  <a className="btn small" href={mailtoHref(d)} onClick={() => openMailApp(d)}>
                    메일 프로그램으로 열기
                  </a>
                  <button
                    className="btn small"
                    onClick={() => {
                      navigator.clipboard?.writeText(`${d.subject}\n\n${d.body}`).catch(() => undefined);
                      setResults((cur) => ({ ...cur, [d.key]: cur[d.key]?.real ? cur[d.key] : { ok: true, text: "제목과 본문을 복사했습니다." } }));
                    }}
                  >
                    복사
                  </button>
                  <button className="btn small" onClick={() => onRemove(d.key)}>
                    이번에서 빼기
                  </button>
                  {res && <span className={`send-result ${res.ok ? "ok" : ""}`}>{res.text}</span>}
                </div>
              </section>
            );
          })}
        </div>

        <div className="composer-foot">
          {missingSubmitTo && <span className="field-err">서류를 받을 메일 주소를 넣어 주세요.</span>}
          {invalid.length > 0 && <span className="field-err">받는 사람 주소를 확인할 메일 {invalid.length}통</span>}
          <span className="spacer" />
          {canSend && (
            <>
              <input
                className="test-to"
                type="email"
                placeholder="시험 발송 받을 내 주소"
                value={testTo}
                onChange={(e) => setTestTo(e.target.value)}
                aria-label="시험 발송 주소"
              />
              <button className="btn" disabled={sending || !testTo || !list.length} onClick={() => send(list.slice(0, 3), true)}>
                나에게 시험 발송 (최대 3통)
              </button>
              {confirming ? (
                <>
                  <span>{pending.length}곳에 실제로 보냅니다.</span>
                  <button className="btn primary" disabled={sending} onClick={() => send(pending, false)}>
                    보내기
                  </button>
                  <button className="btn" onClick={() => setConfirming(false)}>
                    취소
                  </button>
                </>
              ) : (
                <button
                  className="btn primary"
                  disabled={sending || !pending.length || invalid.length > 0 || missingSubmitTo}
                  onClick={() => setConfirming(true)}
                >
                  {sending ? "보내는 중…" : `${pending.length}통 모두 보내기`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
