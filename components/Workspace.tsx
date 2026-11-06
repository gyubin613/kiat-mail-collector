"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { checkDocument } from "@/lib/check";
import type { AiClassifyRequest, AiClassifyResult } from "@/lib/ai/classify";
import { buildWorkbook, buildZip, exportBaseName } from "@/lib/exporter";
import { buildHandoverHtml } from "@/lib/handover";
import {
  computeVersions,
  contactSummary,
  fromLedgerMail,
  initialKpass,
  kpassItems,
  toLedgerMail,
  withFileInfo,
  type LedgerEvent,
  type LedgerSnapshot,
  type ProjectsDoc,
} from "@/lib/ledger";
import { parseAll, parseEml, sha256Hex, type LoadedFile } from "@/lib/mail";
import { matchAll, matchInstitution, matchMail, stripQuoted } from "@/lib/matcher";
import { planFiles, projectStatus, STATUS_LABEL } from "@/lib/organize";
import { rowsToProjects, type ColumnReport } from "@/lib/projects";
import { readSheet } from "@/lib/readSheet";
import type { MailKind, ReminderLogEntry } from "@/lib/reminder";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { kstDateTime } from "@/lib/text";
import type { CheckState, KpassState, MailResult, MatchStatus, ParsedMail, Project, Settings } from "@/lib/types";
import { api } from "./api";
import { Compose, type MailStatus } from "./Compose";
import { Detail } from "./Detail";
import { Dropzone } from "./Dropzone";
import { KpassView } from "./KpassView";
import { Ledger } from "./Ledger";
import { ProjectLog } from "./ProjectLog";
import { SettingsPanel } from "./SettingsPanel";
import { StatusMatrix } from "./StatusMatrix";
import { TransferDialog } from "./TransferDialog";

type Filter = "all" | MatchStatus;
type View = "ledger" | "status" | "kpass" | "log";
const TAB_ORDER: Filter[] = ["all", "auto", "confirmed", "review", "unmatched", "excluded"];

function download(bytes: Uint8Array, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function fetchSample(path: string): Promise<LoadedFile> {
  const r = await fetch(encodeURI(path));
  if (!r.ok) throw new Error(`가상 데이터를 불러오지 못했습니다 (${r.status})`);
  return { name: decodeURI(path.split("/").pop()!), bytes: new Uint8Array(await r.arrayBuffer()) };
}

interface AiStatus {
  enabled: boolean;
  label: string;
}

export interface Me {
  dept: { code: string; name: string; demo: boolean };
  user: string;
}

/** 새로 들어온 메일 결과에 K-PASS 상태와 자동 점검 결과를 채운다 */
async function enrich(mail: ParsedMail, r: MailResult, settings: Settings, projects: Project[]): Promise<MailResult> {
  const base = withFileInfo(mail, r);
  const settled = base.status === "auto" || base.status === "confirmed";
  const project = projects.find((p) => p.id === base.projectId);
  const inst = project?.institutions.find((i) => i.key === base.institutionKey);
  const attachments = await Promise.all(
    base.attachments.map(async (a) => {
      if (a.docType === "기타") return a;
      const kpass = a.kpass ?? (settled ? initialKpass(mail.date, settings, a.docType) : undefined);
      if (a.check || mail.stub) return { ...a, kpass };
      const file = mail.attachments[a.index];
      const auto = await checkDocument(file, { docType: a.docType, projectId: base.projectId, institution: inst });
      return { ...a, kpass, check: { auto, state: "미점검" as CheckState, note: "" } };
    }),
  );
  return { ...base, attachments };
}

export default function Workspace({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [storage, setStorage] = useState<"upstash" | "memory">("memory");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [projectsDoc, setProjectsDoc] = useState<ProjectsDoc | null>(null);
  const [columns, setColumns] = useState<{ report: ColumnReport; warnings: string[] } | null>(null);
  const [mails, setMails] = useState<ParsedMail[]>([]);
  const [results, setResults] = useState<MailResult[]>([]);
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [view, setView] = useState<View>("ledger");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [mailStatus, setMailStatus] = useState<MailStatus | null>(null);
  const [imap, setImap] = useState<{ configured: boolean; label: string } | null>(null);
  const [aiBusy, setAiBusy] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [compose, setCompose] = useState<MailKind | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [focusProject, setFocusProject] = useState<string | null>(null);
  const [sentKeys, setSentKeys] = useState<string[]>([]);

  const projects = useMemo(() => projectsDoc?.projects ?? [], [projectsDoc]);
  const user = me.user;

  const say = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 4200);
  }, []);
  const fail = useCallback((e: unknown) => say(`처리하지 못했습니다: ${(e as Error).message}`), [say]);

  const applySnapshot = useCallback((snap: LedgerSnapshot) => {
    setStorage(snap.storage);
    setSettings(snap.settings ?? DEFAULT_SETTINGS);
    setProjectsDoc(snap.projects);
    setEvents(snap.events);
    // 이번 작업에서 원문을 가진 메일은 그대로 두고, 나머지는 기록에서 복원
    setMails((cur) => {
      const live = new Map(cur.filter((m) => !m.stub).map((m) => [m.id, m]));
      return snap.mails.map((l) => live.get(l.key) ?? fromLedgerMail(l).mail);
    });
    setResults(snap.mails.map((l) => ({ ...l.result, mailId: l.key })));
  }, []);

  const reload = useCallback(async () => {
    applySnapshot(await api<LedgerSnapshot>("/api/ledger"));
  }, [applySnapshot]);

  useEffect(() => {
    reload()
      .catch(fail)
      .finally(() => setLoaded(true));
    api<AiStatus>("/api/ai/status").then(setAi).catch(() => setAi(null));
    api<MailStatus>("/api/mail/status").then(setMailStatus).catch(() => setMailStatus(null));
    api<{ configured: boolean; label: string }>("/api/imap/status").then(setImap).catch(() => setImap(null));
  }, [reload, fail]);

  const projectsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const mailsById = useMemo(() => new Map(mails.map((m) => [m.id, m])), [mails]);
  const resultsById = useMemo(() => new Map(results.map((r) => [r.mailId, r])), [results]);
  const versions = useMemo(() => computeVersions(mails, results), [mails, results]);
  const status = useMemo(() => projectStatus(mails, results, projects, settings), [mails, results, projects, settings]);
  const shownStatus = useMemo(() => (mineOnly ? status.filter((r) => r.project.manager === user) : status), [status, mineOnly, user]);
  const reminded = useMemo(() => contactSummary(events, "독촉"), [events]);
  const kpassList = useMemo(() => kpassItems(mails, results, versions), [mails, results, versions]);

  // ---------- 서버 기록 ----------
  const logEvents = useCallback(async (evs: Partial<LedgerEvent>[]) => {
    if (!evs.length) return;
    try {
      const r = await api<{ events: LedgerEvent[] }>("/api/ledger/events", { body: { events: evs } });
      setEvents((cur) => [...cur, ...r.events]);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  const saveResults = useCallback(
    async (changed: MailResult[], evs: Partial<LedgerEvent>[] = []) => {
      if (!changed.length) return;
      const map = new Map(changed.map((r) => [r.mailId, r]));
      setResults((rs) => rs.map((r) => map.get(r.mailId) ?? r));
      try {
        for (let i = 0; i < changed.length; i += 150) {
          await api("/api/ledger/mails", { method: "PATCH", body: { updates: changed.slice(i, i + 150).map((r) => ({ key: r.mailId, result: r })) } });
        }
        await logEvents(evs);
      } catch (e) {
        fail(e);
      }
    },
    [logEvents, fail],
  );

  const update = (mailId: string, fn: (r: MailResult) => MailResult, ev?: Partial<LedgerEvent>) => {
    const cur = resultsById.get(mailId);
    if (!cur) return;
    const next = fn(cur);
    const evs: Partial<LedgerEvent>[] = ev
      ? [{ ...ev, mailKey: mailId, projectId: ev.projectId ?? next.projectId ?? undefined, institutionKey: ev.institutionKey ?? next.institutionKey ?? undefined }]
      : [];
    void saveResults([next], evs);
  };

  // ---------- 과제관리 현황 ----------
  const loadProjects = async (files: LoadedFile[]): Promise<ProjectsDoc | null> => {
    const f = files[0];
    if (!f) return null;
    try {
      setBusy("과제관리 현황을 읽는 중");
      const rows = await readSheet(f.bytes, f.name);
      const { projects: ps, warnings, columns: report } = rowsToProjects(rows);
      setColumns({ report, warnings });
      if (!ps.length) return null;
      const doc = await api<ProjectsDoc>("/api/ledger/projects", { method: "PUT", body: { projects: ps, sourceName: f.name } });
      setProjectsDoc(doc);
      // 담당자가 고치지 않은 메일은 새 현황으로 다시 분류
      const changed: MailResult[] = [];
      for (const r of results) {
        if (r.edited || r.aiAssisted) continue;
        const m = mailsById.get(r.mailId);
        if (!m) continue;
        const fresh = matchMail(m, doc.projects, settings);
        if (fresh.projectId === r.projectId && fresh.institutionKey === r.institutionKey && fresh.status === r.status) continue;
        changed.push({
          ...fresh,
          summary: r.summary,
          attachments: fresh.attachments.map((a) => ({ ...r.attachments.find((x) => x.index === a.index), ...a, check: r.attachments.find((x) => x.index === a.index)?.check, kpass: r.attachments.find((x) => x.index === a.index)?.kpass })),
        });
      }
      await saveResults(changed);
      await reload();
      say(`과제 ${doc.projects.length}개를 저장했습니다.${changed.length ? ` 메일 ${changed.length}통을 새 현황으로 다시 분류했습니다.` : ""}`);
      return doc;
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(null);
    }
  };

  // ---------- 메일 받기 ----------
  const ingest = async (parsed: ParsedMail[], via: "upload" | "imap", extra = "", ps: Project[] = projects, st: Settings = settings) => {
    const projects = ps;
    const settings = st;
    if (!projects.length) {
      say("먼저 과제관리 현황을 올려 주세요.");
      return;
    }
    const known = new Map(mails.map((m) => [m.id, m]));
    const relink = parsed.filter((m) => known.get(m.id)?.stub);
    const fresh = parsed.filter((m) => !known.has(m.id));
    const dup = parsed.length - fresh.length - relink.length;
    setBusy(`메일 ${fresh.length}통을 분류·점검하는 중`);
    try {
      const matched = matchAll(fresh, projects, settings);
      const enriched: MailResult[] = [];
      for (let i = 0; i < fresh.length; i++) enriched.push(await enrich(fresh[i], matched[i], settings, projects));
      let added: string[] = [];
      for (let i = 0; i < fresh.length; i += 100) {
        const chunk = fresh.slice(i, i + 100).map((m, j) => toLedgerMail(m, enriched[i + j], user, via));
        const r = await api<{ added: string[]; skipped: string[] }>("/api/ledger/mails", { body: { mails: chunk } });
        added = added.concat(r.added);
      }
      // 원문 연결 + 새 메일 반영
      const relinkMap = new Map(relink.map((m) => [m.id, m]));
      setMails((cur) => [...cur.map((m) => relinkMap.get(m.id) ?? m), ...fresh.filter((m) => added.includes(m.id))].sort((a, b) => a.date.localeCompare(b.date)));
      setResults((cur) => [...cur, ...enriched.filter((r) => added.includes(r.mailId))]);
      if (added.length < fresh.length) await reload();
      else {
        const snap = await api<LedgerSnapshot>("/api/ledger");
        setEvents(snap.events);
      }
      setFilter("all");
      say(
        [
          `새 메일 ${added.length}통을 접수했습니다.`,
          dup ? `이미 접수된 메일 ${dup}통은 건너뛰었습니다.` : "",
          relink.length ? `기록만 있던 메일 ${relink.length}통에 원문을 연결했습니다.` : "",
          extra,
        ]
          .filter(Boolean)
          .join(" "),
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const loadMails = async (files: LoadedFile[]) => {
    if (!files.length) return;
    setBusy("메일을 읽는 중");
    try {
      const { mails: ms, errors, duplicates } = await parseAll(files);
      await ingest(ms, "upload", [errors.length ? `읽지 못한 파일 ${errors.length}개.` : "", duplicates ? `같은 메일 파일 ${duplicates}개는 한 번만 읽었습니다.` : ""].filter(Boolean).join(" "));
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  };

  const fetchImap = async () => {
    setBusy("수집 메일함을 확인하는 중");
    try {
      const since = settings.kpassWindow.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { messages } = await api<{ messages: { uid: number; messageId: string; size: number }[] }>("/api/imap/list", { body: { folder: settings.imapFolder, since } });
      const knownIds = new Set(mails.filter((m) => !m.stub).map((m) => m.id));
      const todo: number[] = [];
      for (const m of messages) {
        const key = m.messageId ? `m${(await sha256Hex(m.messageId)).slice(0, 16)}` : "";
        if (!key || !knownIds.has(key)) todo.push(m.uid);
      }
      if (!todo.length) {
        say(`새 메일이 없습니다 (${since} 이후 ${messages.length}통 확인).`);
        setBusy(null);
        return;
      }
      const parsed: ParsedMail[] = [];
      const tooLarge: number[] = [];
      let queue = todo;
      while (queue.length) {
        setBusy(`메일 가져오는 중 (${parsed.length}/${todo.length})`);
        const r = await api<{ items: { uid: number; raw: string }[]; tooLarge: { uid: number }[]; deferred: number[] }>("/api/imap/fetch", {
          body: { folder: settings.imapFolder, uids: queue.slice(0, 100) },
        });
        for (const it of r.items) {
          const bytes = Uint8Array.from(atob(it.raw), (c) => c.charCodeAt(0));
          parsed.push(await parseEml(bytes, `imap-${it.uid}.eml`, ""));
        }
        tooLarge.push(...r.tooLarge.map((t) => t.uid));
        queue = [...r.deferred, ...queue.slice(100)];
        if (!r.items.length && r.deferred.length) break;
      }
      await ingest(parsed, "imap", tooLarge.length ? `용량이 커서 가져오지 못한 메일 ${tooLarge.length}통은 두레이에서 .eml로 저장해 올려 주세요.` : "");
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  };

  const loadSamples = async () => {
    try {
      const doc = await loadProjects([await fetchSample("/samples/과제관리현황_가상.xlsx")]);
      if (!doc) return;
      let st = settings;
      if (!settings.kpassWindow.from) {
        st = await api<Settings>("/api/ledger/settings", {
          method: "PUT",
          body: { ...settings, kpassWindow: { from: "2026-11-28", to: "2027-01-04" }, deadlines: { 참여확약서: "2026-12-11", 협약서: "2026-12-18", 재무증빙: "2026-12-18" }, submitTo: "intl-docs@kiat-demo.example.kr" },
        });
        setSettings(st);
      }
      const { mails: ms } = await parseAll([await fetchSample("/samples/가상메일.zip")]);
      await ingest(ms, "upload", "", doc.projects, st);
    } catch (e) {
      fail(e);
    }
  };

  // ---------- 분류 고치기 ----------
  const assign = (mailId: string, projectId: string | null) => {
    const mail = mailsById.get(mailId);
    const inst = mail ? matchInstitution(mail, projectId ? projectsById.get(projectId) : undefined) : { key: null, reason: "" };
    update(
      mailId,
      (r) => ({
        ...r,
        projectId,
        institutionKey: inst.key,
        institutionReason: inst.reason,
        relevant: true,
        status: projectId ? "confirmed" : "unmatched",
        edited: true,
        attachments: r.attachments.map((a) => ({ ...a, kpass: a.kpass ?? (projectId && mail ? initialKpass(mail.date, settings, a.docType) : undefined) })),
      }),
      projectId ? { type: "분류", projectId, text: `과제 지정: ${mail?.subject ?? ""}` } : undefined,
    );
  };

  const setCheck = (mailId: string, index: number, state: CheckState, note: string) => {
    const r = resultsById.get(mailId);
    const a = r?.attachments.find((x) => x.index === index);
    update(
      mailId,
      (cur) => ({
        ...cur,
        attachments: cur.attachments.map((x) => (x.index === index ? { ...x, check: { ...(x.check ?? { state: "미점검", note: "" }), state, note, by: user, at: new Date().toISOString() } } : x)),
      }),
      { type: "점검", text: `${a?.docType ?? "서류"} ${state}${note ? `: ${note}` : ""} (${a?.filename ?? ""})` },
    );
  };

  const recheck = async (mailId: string, index: number) => {
    const m = mailsById.get(mailId);
    const r = resultsById.get(mailId);
    if (!m || !r || m.stub) return;
    const a = r.attachments.find((x) => x.index === index)!;
    const p = projectsById.get(r.projectId ?? "");
    const auto = await checkDocument(m.attachments[index], { docType: a.docType, projectId: r.projectId, institution: p?.institutions.find((i) => i.key === r.institutionKey) });
    update(mailId, (cur) => ({ ...cur, attachments: cur.attachments.map((x) => (x.index === index ? { ...x, check: { ...(x.check ?? { state: "미점검", note: "" }), auto } } : x)) }));
  };

  const setKpass = (refs: string[], state: KpassState) => {
    const byMail = new Map<string, number[]>();
    for (const ref of refs) {
      const [id, idx] = ref.split("#");
      byMail.set(id, [...(byMail.get(id) ?? []), Number(idx)]);
    }
    const now = new Date().toISOString();
    const changed: MailResult[] = [];
    const evs: Partial<LedgerEvent>[] = [];
    for (const [id, idxs] of byMail) {
      const r = resultsById.get(id);
      if (!r) continue;
      changed.push({
        ...r,
        attachments: r.attachments.map((a) =>
          idxs.includes(a.index) ? { ...a, kpass: state, kpassAt: state === "등록 완료" ? now : undefined, kpassBy: state === "등록 완료" ? user : undefined } : a,
        ),
      });
      for (const i of idxs) {
        const a = r.attachments.find((x) => x.index === i);
        evs.push({ type: "K-PASS", projectId: r.projectId ?? undefined, institutionKey: r.institutionKey ?? undefined, mailKey: id, text: `${a?.docType ?? "서류"} K-PASS ${state} (${a?.filename ?? ""})` });
      }
    }
    void saveResults(changed, evs);
    say(`${refs.length}건을 '${state}'로 표시했습니다.`);
  };

  // ---------- AI ----------
  const askAi = async (mailId: string) => {
    const mail = mailsById.get(mailId);
    const r = resultsById.get(mailId);
    if (!mail || !r || mail.stub) return;
    const candIds = r.candidates.map((c) => c.projectId);
    const cands = (candIds.length ? candIds.map((id) => projectsById.get(id)!).filter(Boolean) : projects).slice(0, 80);
    const req: AiClassifyRequest = {
      mail: { subject: mail.subject, fromName: mail.fromName, fromAddress: mail.fromAddress, date: mail.date, body: stripQuoted(mail.text).slice(0, 4000), attachments: mail.attachments.map((a) => a.filename) },
      candidates: cands.map((p) => ({ id: p.id, name: p.name, leadOrg: p.leadOrg, partnerOrg: p.partnerOrg, country: p.country })),
      docTypes: settings.requiredDocs,
    };
    setAiBusy((s) => new Set(s).add(mailId));
    try {
      const data = await api<AiClassifyResult>("/api/ai/classify", { body: req });
      const pid = data.projectId ?? r.projectId;
      const inst = matchInstitution(mail, pid ? projectsById.get(pid) : undefined);
      update(mailId, (cur) => ({
        ...cur,
        projectId: pid,
        institutionKey: data.projectId ? inst.key : cur.institutionKey,
        institutionReason: data.projectId ? inst.reason : cur.institutionReason,
        status: data.projectId ? (data.confidence >= 85 ? "auto" : "review") : cur.status,
        confidence: data.projectId ? data.confidence : cur.confidence,
        reasons: data.reason ? [...cur.reasons.filter((x) => !x.startsWith("AI:")), `AI: ${data.reason}`] : cur.reasons,
        summary: data.summary || cur.summary,
        attachments: cur.attachments.map((a, i) =>
          a.docType === "기타" && data.attachmentTypes[i] && data.attachmentTypes[i] !== "기타" ? { ...a, docType: data.attachmentTypes[i], docReason: "AI 판단" } : a,
        ),
        aiAssisted: true,
      }));
    } catch (e) {
      say(`AI 판단 실패: ${(e as Error).message}`);
    } finally {
      setAiBusy((s) => {
        const n = new Set(s);
        n.delete(mailId);
        return n;
      });
    }
  };

  // ---------- 소통 메일 ----------
  const onLogged = (entries: ReminderLogEntry[]) => {
    const ok = entries.filter((e) => e.ok && e.mode !== "시험 발송");
    setSentKeys((cur) => [...cur, ...ok.map((e) => e.key)]);
    void logEvents(
      ok.map((e) => ({
        type: (e.kind ?? "독촉") as LedgerEvent["type"],
        projectId: e.projectId,
        institutionKey: e.key,
        text: `${e.kind ?? "독촉"} 메일 (${e.mode}): ${e.subject} → ${e.to}`,
      })),
    );
  };

  const commLog: ReminderLogEntry[] = useMemo(
    () =>
      events
        .filter((e) => e.type === "독촉" || e.type === "보완 요청" || e.type === "접수 확인")
        .map((e) => ({
          kind: e.type as MailKind,
          key: e.institutionKey ?? "",
          projectId: e.projectId ?? "",
          institution: projectsById.get(e.projectId ?? "")?.institutions.find((i) => i.key === e.institutionKey)?.name ?? "",
          to: "",
          subject: e.text,
          docs: [],
          at: e.at,
          mode: "발송",
          ok: true,
        })),
    [events, projectsById],
  );

  // ---------- 담당자 이관 ----------
  const openHandover = (from: string, to: string, ids: string[]) => {
    const kpassWaiting = new Map<string, number>();
    for (const k of kpassList) if (k.state === "등록 대기" && k.latest) kpassWaiting.set(k.projectId, (kpassWaiting.get(k.projectId) ?? 0) + 1);
    const html = buildHandoverHtml({
      deptName: me.dept.name,
      from,
      to,
      by: user,
      rows: status.filter((r) => ids.includes(r.project.id)),
      events,
      settings,
      kpassWaiting,
    });
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const w = window.open(url, "_blank");
    if (!w) {
      const a = document.createElement("a");
      a.href = url;
      a.download = `인수인계서_${from}_${to}.html`;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  };

  // ---------- 내보내기 ----------
  const exportInput = () => ({ mails, results, projects, settings, reminderLog: commLog, kpass: kpassList, versions });
  const exportExcel = async () => {
    setBusy("엑셀을 만드는 중");
    try {
      const bytes = await buildWorkbook(exportInput(), planFiles(mails, results, projects));
      download(bytes, `${exportBaseName()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } finally {
      setBusy(null);
    }
  };
  const exportZip = async (only?: Set<string>) => {
    setBusy("폴더를 정리하는 중");
    try {
      const { zip, plan } = await buildZip(exportInput(), only);
      download(zip, `${exportBaseName()}${only ? "_K-PASS등록" : ""}.zip`, "application/zip");
      const missing = plan.filter((p) => !p.available && (!only || only.has(`${p.mailId}#${p.attachmentIndex}`))).length;
      say(`파일 ${plan.filter((p) => p.available && (!only || only.has(`${p.mailId}#${p.attachmentIndex}`))).length}개를 정리했습니다.${missing ? ` 이번에 올리지 않은 메일의 파일 ${missing}개는 빠졌습니다.` : ""}`);
    } finally {
      setBusy(null);
    }
  };

  // ---------- 화면 ----------
  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: results.length, auto: 0, confirmed: 0, review: 0, unmatched: 0, excluded: 0 };
    for (const r of results) c[r.status] += 1;
    return c;
  }, [results]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return results
      .filter((r) => filter === "all" || r.status === filter)
      .map((r) => ({ mail: mailsById.get(r.mailId)!, result: r }))
      .filter(({ mail, result }) => {
        if (!mail) return false;
        const p = result.projectId ? projectsById.get(result.projectId) : undefined;
        if (mineOnly && p && p.manager !== user) return false;
        if (!q) return true;
        return [mail.subject, mail.fromName, mail.fromAddress, p?.id, p?.name, p?.partnerOrg, ...mail.attachments.map((a) => a.filename)]
          .filter(Boolean)
          .some((s) => String(s).toLowerCase().includes(q));
      })
      .reverse();
  }, [results, filter, query, mailsById, projectsById, mineOnly, user]);

  const sel = selected ? { mail: mailsById.get(selected), result: resultsById.get(selected) } : null;
  const remaining = counts.review + counts.unmatched;
  const kpassWaitingCount = kpassList.filter((k) => k.state === "등록 대기" && k.latest).length;
  const composeRows = compose ? status.flatMap((p) => p.institutions).filter((r) => picked.has(r.institution.key)) : [];

  if (!loaded) return <div className="empty" style={{ margin: 40 }}>접수대장을 불러오는 중…</div>;

  return (
    <>
      <header className="top">
        <div className="top-inner">
          <div>
            <h1 className="title">과제 서류 메일 정리 도우미</h1>
            <p className="subtitle">
              <b>{me.dept.name}</b> / {user}
              {projectsDoc && (
                <span className="sub-meta">
                  {" "}
                  / 과제관리 현황 {projectsDoc.sourceName} ({kstDateTime(projectsDoc.importedAt).slice(0, 10)} {projectsDoc.importedBy})
                </span>
              )}
            </p>
          </div>
          <div className="top-actions">
            <label className="mine">
              <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> 내 과제만
            </label>
            <button className="btn" onClick={() => setShowSettings(true)}>
              실 설정
            </button>
            <button
              className="btn"
              onClick={async () => {
                await api("/api/auth/logout", { body: {} }).catch(() => undefined);
                onLogout();
              }}
            >
              나가기
            </button>
          </div>
        </div>
        {(me.dept.demo || storage === "memory") && (
          <div className="banner">
            {me.dept.demo && "체험용 실입니다. 실제 자료는 올리지 마세요. "}
            {storage === "memory" && "시연 모드: 저장소가 연결되지 않아 서버를 다시 켜면 기록이 사라집니다."}
            {me.dept.demo && (
              <button
                className="linkish"
                onClick={async () => {
                  if (!window.confirm("체험용 실의 기록을 모두 지웁니다.")) return;
                  await api("/api/ledger", { method: "DELETE", body: {} }).catch(fail);
                  setMails([]);
                  setResults([]);
                  await reload();
                }}
              >
                체험 기록 비우기
              </button>
            )}
          </div>
        )}
      </header>

      <section className="steps" aria-label="작업 순서">
        <div className={`step${projects.length ? " done" : ""}`}>
          <div className="step-head">
            <span className="step-no">1</span>
            <span className="step-title">과제관리 현황</span>
          </div>
          <Dropzone accept=".xlsx,.csv" label={projects.length ? "새 현황으로 바꾸기" : "과제관리 현황 엑셀 올리기"} hint="실에서 쓰는 현황 파일 그대로 올리세요. 전화번호·주소 같은 열은 읽지 않습니다" onFiles={loadProjects} />
          <div className="step-result">
            {projects.length > 0 && (
              <span>
                과제 <b className="num">{projects.length}</b>개, 기관 <b className="num">{projects.reduce((n, p) => n + p.institutions.length, 0)}</b>곳
              </span>
            )}
            {columns && columns.report.dropped.length > 0 && (
              <details className="cols">
                <summary>읽지 않은 열 {columns.report.dropped.length}개</summary>
                <ul>
                  {columns.report.dropped.map((d) => (
                    <li key={d.header}>
                      {d.header}: {d.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {columns?.warnings.map((w) => (
              <span key={w} className="warn">
                {w}
              </span>
            ))}
          </div>
        </div>

        <div className={`step${mails.length ? " done" : ""}`}>
          <div className="step-head">
            <span className="step-no">2</span>
            <span className="step-title">받은 메일</span>
          </div>
          {imap?.configured && (
            <button className="btn primary" onClick={fetchImap} disabled={!!busy || !projects.length}>
              수집 메일함에서 새 메일 가져오기
            </button>
          )}
          <Dropzone accept=".eml,.zip" multiple label="메일 파일 올리기" hint="두레이에서 저장한 .eml(또는 묶은 .zip). 이미 접수된 메일은 건너뜁니다" onFiles={loadMails} disabled={!projects.length} />
          <div className="step-result">
            접수대장 <b className="num">{mails.length}</b>통
            {mails.some((m) => m.stub) && <span className="sub-meta"> (그중 원문 없이 기록만 {mails.filter((m) => m.stub).length}통)</span>}
          </div>
        </div>

        <div className="step">
          <div className="step-head">
            <span className="step-no">3</span>
            <span className="step-title">확인하고 연락하기</span>
          </div>
          {mails.length > 0 ? (
            <ul className="todo">
              <li className={remaining ? "warn" : ""}>
                분류 확인 필요 <b className="num">{remaining}</b>통
              </li>
              <li className={status.some((s) => s.institutions.some((i) => i.remindDocs.length)) ? "bad" : ""}>
                미제출 기관 <b className="num">{status.reduce((n, s) => n + s.institutions.filter((i) => i.remindDocs.length).length, 0)}</b>곳
              </li>
              <li className={status.some((s) => s.institutions.some((i) => i.fixDocs.length)) ? "warn" : ""}>
                보완 요청할 기관 <b className="num">{status.reduce((n, s) => n + s.institutions.filter((i) => i.fixDocs.length).length, 0)}</b>곳
              </li>
              <li>
                K-PASS 등록 대기 <b className="num">{kpassWaitingCount}</b>건
              </li>
            </ul>
          ) : (
            <>
              <p className="step-desc">메일이 들어오면 분류 확인, 미제출 기관 독촉, 보완 요청, K-PASS 등록할 일이 여기에 모입니다.</p>
              {me.dept.demo && (
                <button className="linkish" onClick={loadSamples}>
                  가상 데이터로 한 번에 체험하기
                </button>
              )}
            </>
          )}
        </div>
      </section>

      <main className="work">
        {!projects.length ? (
          <div className="empty">
            <p>먼저 과제관리 현황 엑셀을 올려 주세요.</p>
            <p style={{ fontSize: 13 }}>과제관리 현황이 있어야 메일을 과제·기관별로 분류할 수 있습니다.</p>
          </div>
        ) : (
          <>
            <div className="toolbar">
              <div className="views" role="group" aria-label="보기 전환">
                {(
                  [
                    ["ledger", "메일 접수대장"],
                    ["status", "기관별 제출현황"],
                    ["kpass", `K-PASS 등록${kpassWaitingCount ? ` (${kpassWaitingCount})` : ""}`],
                    ["log", "과제 기록"],
                  ] as [View, string][]
                ).map(([v, label]) => (
                  <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="spacer" />
              {ai?.enabled ? <span className="ai-note">{ai.label}</span> : <span className="ai-note">AI 판단 꺼짐: 규칙으로만 분류합니다</span>}
            </div>

            {view === "ledger" && (
              <>
                <div className="toolbar" style={{ marginBottom: 0 }}>
                  <div className="tabs" role="tablist" aria-label="처리 상태" style={{ flex: 1 }}>
                    {TAB_ORDER.map((t) => (
                      <button key={t} role="tab" aria-selected={filter === t} className={`tab ${t}`} onClick={() => setFilter(t)}>
                        {t === "all" ? "전체" : STATUS_LABEL[t]}
                        <span className="count">{counts[t]}</span>
                      </button>
                    ))}
                  </div>
                  {ai?.enabled && remaining > 0 && (
                    <button
                      className="btn"
                      disabled={aiBusy.size > 0}
                      onClick={async () => {
                        for (const r of results.filter((x) => (x.status === "review" || x.status === "unmatched") && !x.aiAssisted && !mailsById.get(x.mailId)?.stub)) await askAi(r.mailId);
                      }}
                    >
                      {aiBusy.size ? `AI가 읽는 중 (${aiBusy.size})` : `확인 필요·미분류 AI에게 맡기기`}
                    </button>
                  )}
                  <input className="search" type="search" placeholder="제목, 보낸 사람, 과제, 파일명 검색" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="메일 검색" />
                </div>
                <div className={`split${sel?.mail && sel.result ? " with-detail" : ""}`}>
                  <Ledger rows={rows} projectsById={projectsById} selected={selected} onSelect={setSelected} />
                  {sel?.mail && sel.result && (
                    <Detail
                      mail={sel.mail}
                      result={sel.result}
                      projects={projects}
                      projectsById={projectsById}
                      docTypes={settings.requiredDocs}
                      versions={versions}
                      aiEnabled={!!ai?.enabled}
                      aiBusy={aiBusy.has(sel.mail.id)}
                      onClose={() => setSelected(null)}
                      onAssign={(pid) => assign(sel.mail!.id, pid)}
                      onInstitution={(key) => update(sel.mail!.id, (r) => ({ ...r, institutionKey: key, institutionReason: key ? "담당자 지정" : "", edited: true }))}
                      onConfirm={() => update(sel.mail!.id, (r) => ({ ...r, status: "confirmed", edited: true }), { type: "분류", text: `분류 확인: ${sel.mail!.subject}` })}
                      onDocType={(i, type) =>
                        update(sel.mail!.id, (r) => ({ ...r, edited: true, attachments: r.attachments.map((a) => (a.index === i ? { ...a, docType: type, docReason: "담당자 지정", check: undefined } : a)) }))
                      }
                      onCheck={(i, s, n) => setCheck(sel.mail!.id, i, s, n)}
                      onRecheck={(i) => void recheck(sel.mail!.id, i)}
                      onKpass={(i, s) => setKpass([`${sel.mail!.id}#${i}`], s)}
                      onExclude={() =>
                        update(sel.mail!.id, (r) => ({ ...r, relevant: false, status: "excluded", projectId: null, institutionKey: null, relevanceReason: "담당자가 업무 메일 아님으로 표시", edited: true }))
                      }
                      onInclude={() => {
                        const fresh = matchMail(sel.mail!, projects, settings);
                        update(sel.mail!.id, (cur) => ({ ...fresh, summary: cur.summary, relevant: true, status: fresh.status === "excluded" ? "unmatched" : fresh.status, edited: true }));
                      }}
                      onAskAi={() => askAi(sel.mail!.id)}
                    />
                  )}
                </div>
              </>
            )}

            {view === "status" && (
              <StatusMatrix
                rows={shownStatus}
                settings={settings}
                versions={versions}
                sent={reminded}
                selected={picked}
                onSelect={(keys, on) =>
                  setPicked((cur) => {
                    const n = new Set(cur);
                    for (const k of keys) {
                      if (on) n.add(k);
                      else n.delete(k);
                    }
                    return n;
                  })
                }
                onOpenProject={(id) => {
                  setFocusProject(id);
                  setView("log");
                }}
                onCompose={(k) => setCompose(k)}
                onOpenSettings={() => setShowSettings(true)}
              />
            )}

            {view === "kpass" && (
              <KpassView
                items={mineOnly ? kpassList.filter((k) => projectsById.get(k.projectId)?.manager === user) : kpassList}
                projectsById={projectsById}
                window={settings.kpassWindow}
                onMark={setKpass}
                onExport={(refs) => void exportZip(new Set(refs))}
                onOpenSettings={() => setShowSettings(true)}
              />
            )}

            {view === "log" && (
              <ProjectLog
                rows={status}
                events={events}
                user={user}
                focus={focusProject}
                onFocus={setFocusProject}
                onMemo={(pid, text) => logEvents([{ type: "메모", projectId: pid, text }])}
                onTransfer={() => setShowTransfer(true)}
                onOpenMails={(pid) => {
                  setView("ledger");
                  setFilter("all");
                  setQuery(pid);
                }}
              />
            )}

            <div className="export">
              <p>
                {remaining > 0 ? (
                  <span className="warn">
                    확인 필요 {counts.review}통, 미분류 {counts.unmatched}통이 남았습니다. 지금 내보내면 이 메일들은 &apos;01_확인필요&apos;, &apos;00_미분류&apos; 폴더에 따로 담깁니다.
                  </span>
                ) : (
                  "엑셀(기관별 제출현황·과제별 요약·메일·첨부·소통 이력·K-PASS 등록 목록)과 과제별 폴더로 내려받습니다."
                )}
              </p>
              <button className="btn" onClick={exportExcel} disabled={!!busy}>
                엑셀 받기
              </button>
              <button className="btn primary" onClick={() => void exportZip()} disabled={!!busy}>
                과제별 폴더(ZIP) 받기
              </button>
            </div>
          </>
        )}
      </main>

      {compose && (
        <Compose
          kind={compose}
          rows={composeRows.filter((r) => (compose === "독촉" ? r.remindDocs.length : compose === "보완 요청" ? r.fixDocs.length : r.receivedDocs.length) && r.institution.emails.length)}
          sent={reminded}
          mail={mailStatus}
          settings={settings}
          dept={me.dept.name}
          user={user}
          onClose={() => {
            if (sentKeys.length) {
              setPicked((cur) => {
                const n = new Set(cur);
                for (const k of sentKeys) n.delete(k);
                return n;
              });
              setSentKeys([]);
            }
            setCompose(null);
          }}
          onLogged={onLogged}
          onRemove={(k) =>
            setPicked((cur) => {
              const n = new Set(cur);
              n.delete(k);
              if (!n.size) setCompose(null);
              return n;
            })
          }
        />
      )}

      {showSettings && (
        <SettingsPanel
          settings={settings}
          imap={imap}
          onClose={() => setShowSettings(false)}
          onSave={async (s) => {
            const saved = await api<Settings>("/api/ledger/settings", { method: "PUT", body: s });
            setSettings(saved);
            say("실 설정을 저장했습니다.");
          }}
        />
      )}

      {showTransfer && (
        <TransferDialog
          projects={projects}
          user={user}
          onClose={() => setShowTransfer(false)}
          onPreview={(from, to, ids) => openHandover(from, to, ids)}
          onTransfer={async (from, to, ids) => {
            openHandover(from, to, ids);
            const doc = await api<ProjectsDoc>("/api/ledger/transfer", { body: { from, to, projectIds: ids } });
            setProjectsDoc(doc);
            const snap = await api<LedgerSnapshot>("/api/ledger");
            setEvents(snap.events);
            say(`과제 ${ids.length}개를 ${to} 님에게 넘겼습니다.`);
          }}
        />
      )}

      {(busy || toast) && (
        <div className="toast" role="status">
          {busy ? `${busy}…` : toast}
        </div>
      )}
    </>
  );
}
