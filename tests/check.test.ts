import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkDocument, pdfText } from "../lib/check";
import { parseAll } from "../lib/mail";
import { rowsToProjects } from "../lib/projects";
import { readSheet } from "../lib/readSheet";
import type { ParsedMail, Project } from "../lib/types";

const S = join(__dirname, "..", "public", "samples");
let mails: ParsedMail[];
let projects: Project[];
beforeAll(async () => {
  projects = rowsToProjects(await readSheet(new Uint8Array(readFileSync(join(S, "과제관리현황_가상.xlsx"))), "x.xlsx")).projects;
  mails = (await parseAll([{ name: "m.zip", bytes: new Uint8Array(readFileSync(join(S, "가상메일.zip"))) }])).mails;
});
const att = (src: string, i = 0) => mails.find((m) => m.sourceName === src)!.attachments[i];
const partner = (pid: string) => projects.find((p) => p.id === pid)!.institutions.find((i) => i.role === "참여기관")!;

describe("서류 내용 점검", () => {
  it("PDF 글자를 읽는다", async () => {
    expect(await pdfText(att("P0031001_loc.eml").content)).toContain("Letter of Commitment");
  });

  it("서명·날짜·기관명·과제번호가 있으면 이상 없어 보임", async () => {
    const r = await checkDocument(att("P0031001_loc.eml"), { docType: "참여확약서", projectId: "P0031001", institution: partner("P0031001") });
    expect(r.kind).toBe("text");
    expect(r.suggestion).toBe("ok");
    expect(r.items.map((i) => [i.label, i.ok])).toEqual([["서명", true], ["날짜", true], ["기관명", true], ["과제번호", true]]);
  });

  it("서명·날짜가 없는 확약서는 보완 필요", async () => {
    const r = await checkDocument(att("P0031004_loc.eml"), { docType: "참여확약서", projectId: "P0031004", institution: partner("P0031004") });
    expect(r.suggestion).toBe("fix");
    expect(r.items.find((i) => i.label === "서명")!.ok).toBe(false);
    expect(r.items.find((i) => i.label === "날짜")!.ok).toBe(false);
    const again = await checkDocument(att("P0031004_loc_resubmit.eml"), { docType: "참여확약서", projectId: "P0031004", institution: partner("P0031004") });
    expect(again.suggestion).toBe("ok");
  });

  it("재무증빙은 서명이 필수가 아니다", async () => {
    const r = await checkDocument(att("P0031001_finance.eml", 0), { docType: "재무증빙", projectId: "P0031001" });
    expect(r.items.find((i) => i.label === "서명")!.ok).toBeNull();
    expect(r.suggestion).toBe("ok");
  });

  it("스캔본·PDF가 아닌 파일은 직접 확인", async () => {
    expect((await checkDocument(att("P0031006_finance.eml", 1), { docType: "재무증빙" })).kind).toBe("scan");
    const other = await checkDocument({ filename: "a.docx", mimeType: "application/msword", content: new Uint8Array([1, 2]) }, { docType: "협약서" });
    expect(other).toMatchObject({ kind: "other", suggestion: "manual" });
    const broken = await checkDocument({ filename: "a.pdf", mimeType: "application/pdf", content: new Uint8Array([1, 2, 3]) }, { docType: "협약서" });
    expect(broken.kind).toBe("error");
  });
});
