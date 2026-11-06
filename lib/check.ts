// 서류 내용 점검: 브라우저 안에서 PDF 글자를 읽어 서명·날짜·기관명·과제번호를 확인한다.
// 파일 내용은 서버나 AI로 보내지 않는다. 결과는 '추정'이며 담당자가 이상 없음/보완 필요를 정한다.
import { compact, normalize, orgTokens } from "./text";
import type { CheckItem, DocCheck, Institution } from "./types";

type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<Pdfjs> | null = null;

async function loadPdfjs(): Promise<Pdfjs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      if (typeof window !== "undefined") {
        // 작업 스레드 없이 같은 화면에서 읽는다 (별도 파일 배포가 필요 없음)
        const worker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
        (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker;
      }
      return import("pdfjs-dist/legacy/build/pdf.mjs");
    })();
  }
  return pdfjsPromise;
}

export async function pdfText(bytes: Uint8Array, maxPages = 10): Promise<string> {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  try {
    const pages: string[] = [];
    for (let i = 1; i <= Math.min(doc.numPages, maxPages); i++) {
      const page = await doc.getPage(i);
      const tc = await page.getTextContent();
      pages.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(" "));
    }
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

const SIGN_RE = /\bsigned\b|signature|서명|날인|직인|\(인\)|\/s\//i;
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
const DATE_RE = new RegExp(
  `(20\\d{2})\\s*[.\\-/년]\\s*(\\d{1,2})\\s*[.\\-/월]\\s*(\\d{1,2})|\\b\\d{1,2}(st|nd|rd|th)?\\s+(${MONTHS})[a-z]*\\.?\\s+20\\d{2}|\\b(${MONTHS})[a-z]*\\.?\\s+\\d{1,2}(st|nd|rd|th)?,?\\s+20\\d{2}|\\b\\d{1,2}[./]\\d{1,2}[./]20\\d{2}`,
  "i",
);

/** 서명이 꼭 있어야 하는 서류 */
export function signatureRequired(docType: string): boolean {
  return /확약|협약|agreement|commitment|contract/i.test(docType);
}

function orgFound(name: string, text: string): boolean {
  const c = compact(text);
  const full = compact(name);
  if (full.length >= 3 && c.includes(full)) return true;
  const toks = orgTokens(name).filter((t) => t.length >= 3);
  if (!toks.length) return false;
  const n = normalize(text);
  const hit = toks.filter((t) => (/[가-힣]/.test(t) ? c.includes(t) : n.split(" ").includes(t)));
  return hit.length / toks.length >= 0.6;
}

export interface CheckTarget {
  filename: string;
  mimeType: string;
  content: Uint8Array;
}

export async function checkDocument(
  file: CheckTarget,
  ctx: { docType: string; projectId?: string | null; institution?: Institution },
): Promise<NonNullable<DocCheck["auto"]>> {
  const isPdf = /\.pdf$/i.test(file.filename) || file.mimeType === "application/pdf";
  if (!isPdf) {
    return {
      kind: "other",
      suggestion: "manual",
      items: [{ label: "파일 형식", ok: null, detail: "PDF가 아니어서 자동 점검을 하지 않았습니다. 파일을 열어 확인해 주세요." }],
    };
  }
  if (!file.content.byteLength) {
    return { kind: "error", suggestion: "manual", items: [{ label: "파일", ok: null, detail: "이번 작업에 파일 내용이 없습니다." }] };
  }
  let text = "";
  try {
    text = await pdfText(file.content);
  } catch (e) {
    return { kind: "error", suggestion: "manual", items: [{ label: "파일 열기", ok: null, detail: `PDF를 읽지 못했습니다 (${(e as Error).message})` }] };
  }
  if (text.replace(/\s+/g, "").length < 20) {
    return {
      kind: "scan",
      suggestion: "manual",
      items: [{ label: "글자", ok: null, detail: "글자를 읽을 수 없는 스캔본입니다. 서명·날짜를 직접 확인해 주세요." }],
    };
  }

  const items: CheckItem[] = [];
  const needSign = signatureRequired(ctx.docType);
  const signed = SIGN_RE.test(text);
  items.push({
    label: "서명",
    ok: signed ? true : needSign ? false : null,
    detail: signed ? "서명 표시가 있습니다" : needSign ? "서명 표시(Signed, Signature, 서명 등)를 찾지 못했습니다" : "서명 표시 없음 (이 서류는 필수 아님)",
  });
  const date = DATE_RE.exec(text);
  items.push({ label: "날짜", ok: !!date, detail: date ? `날짜: ${date[0].trim()}` : "작성 날짜를 찾지 못했습니다" });
  if (ctx.institution) {
    const ok = orgFound(ctx.institution.name, text);
    items.push({ label: "기관명", ok, detail: ok ? `${ctx.institution.name} 확인` : `${ctx.institution.name} 이름을 찾지 못했습니다` });
  }
  if (ctx.projectId) {
    const ok = compact(text).includes(compact(ctx.projectId));
    items.push({ label: "과제번호", ok: ok ? true : null, detail: ok ? `${ctx.projectId} 확인` : "과제번호가 적혀 있지 않습니다 (필수 아님)" });
  }
  const fix = items.some((i) => (i.label === "서명" || i.label === "날짜") && i.ok === false);
  const orgMissing = items.some((i) => i.label === "기관명" && i.ok === false);
  return { kind: "text", items, suggestion: fix ? "fix" : orgMissing ? "manual" : "ok" };
}

export function suggestionLabel(s: "ok" | "fix" | "manual"): string {
  return s === "ok" ? "이상 없어 보임" : s === "fix" ? "보완 필요해 보임" : "직접 확인 필요";
}
