// 확인용 가상 데이터(2차 묶음·과제별 형식 현황)가 안내한 대로 동작하는지
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { checkDocument } from "../lib/check";
import { computeVersions } from "../lib/ledger";
import { parseAll } from "../lib/mail";
import { matchAll } from "../lib/matcher";
import { projectStatus } from "../lib/organize";
import { rowsToProjects } from "../lib/projects";
import { readSheet } from "../lib/readSheet";
import { DEFAULT_SETTINGS } from "../lib/settings";
import type { MailResult, ParsedMail, Project } from "../lib/types";

const S = join(__dirname, "..", "public", "samples");
const file = (n: string) => ({ name: n, bytes: new Uint8Array(readFileSync(join(S, n))) });
let projects: Project[];
let first: ParsedMail[];
let second: ParsedMail[];
let all: ParsedMail[];
let results: MailResult[];

beforeAll(async () => {
  projects = rowsToProjects(await readSheet(file("과제관리현황_가상.xlsx").bytes, "x.xlsx")).projects;
  first = (await parseAll([file("가상메일.zip")])).mails;
  second = (await parseAll([file("가상메일_2차.zip")])).mails;
  const firstIds = new Set(first.map((m) => m.id));
  all = [...first, ...second.filter((m) => !firstIds.has(m.id))].sort((a, b) => a.date.localeCompare(b.date));
  results = matchAll(all, projects, DEFAULT_SETTINGS);
});
const r = (src: string) => {
  const m = all.find((x) => x.sourceName === src)!;
  return { m, r: results.find((x) => x.mailId === m.id)! };
};

describe("2차 메일 묶음", () => {
  it("11통 중 3통은 1차와 같은 메일이라 새 메일은 8통", () => {
    expect(second).toHaveLength(11);
    const firstIds = new Set(first.map((m) => m.id));
    expect(second.filter((m) => firstIds.has(m.id))).toHaveLength(3);
    expect(all).toHaveLength(53);
  });

  it("보완 후 다시 보낸 확약서는 2차 제출이고 점검이 이상 없어 보임", async () => {
    const { m, r: res } = r("P0031010_loc_signed_again.eml");
    expect(res).toMatchObject({ status: "auto", projectId: "P0031010" });
    const v = computeVersions(all, results).get(`${m.id}#0`)!;
    expect(v).toMatchObject({ version: 2, latest: true });
    const inst = projects.find((p) => p.id === "P0031010")!.institutions.find((i) => i.key === res.institutionKey);
    expect((await checkDocument(m.attachments[0], { docType: "참여확약서", projectId: "P0031010", institution: inst })).suggestion).toBe("ok");
  });

  it("국내 대학 확약서·늦은 재무증빙으로 과제가 완료됨", () => {
    expect(r("P0031003_univ_loc.eml").r).toMatchObject({ status: "auto", projectId: "P0031003" });
    expect(r("P0031008_univ_loc.eml").r.institutionKey).toBe("P0031008::한빛과학기술원");
    expect(r("P0031009_finance_late.eml").r).toMatchObject({ status: "auto", projectId: "P0031009" });
    const st = projectStatus(all, results, projects, DEFAULT_SETTINGS);
    expect(st.find((s) => s.project.id === "P0031008")!.state).toBe("완료");
    expect(st.find((s) => s.project.id === "P0031009")!.state).toBe("완료");
  });

  it("워드 파일은 분류되지만 점검은 직접 확인, 같은 파일은 중복, 모르는 주소는 미분류, 자동 회신은 대상 아님", async () => {
    const docx = r("P0031014_docx.eml");
    expect(docx.r.attachments[0].docType).toBe("참여확약서");
    expect((await checkDocument(docx.m.attachments[0], { docType: "참여확약서" })).kind).toBe("other");
    const dup = r("P0031005_loc_dup_again.eml");
    expect(computeVersions(all, results).get(`${dup.m.id}#0`)!.duplicateOf).toBeTruthy();
    expect(r("unknown_english_title.eml").r.status).toBe("unmatched");
    expect(r("noise_autoreply.eml").r.status).toBe("excluded");
  });
});

describe("과제별 형식 현황", () => {
  it("한 줄에 여러 참여기관이 있어도 기관별로 나누고, 전화·법인번호는 읽지 않음", async () => {
    const res = rowsToProjects(await readSheet(file("과제관리현황_가상_과제별형식.xlsx").bytes, "x.xlsx"));
    expect(res.format).toBe("과제별");
    expect(res.projects).toHaveLength(30);
    expect(res.projects.reduce((n, p) => n + p.institutions.length, 0)).toBe(66);
    const p3 = res.projects.find((p) => p.id === "P0031003")!;
    expect(p3.institutions.map((i) => [i.name, i.emails[0]])).toEqual([
      ["(주)온누리모빌리티", "dychoi@onnurimobility.example.kr"],
      [projects.find((p) => p.id === "P0031003")!.institutions[1].name, projects.find((p) => p.id === "P0031003")!.institutions[1].emails[0]],
      ["누리대학교 산학협력단", "pi2@univ2.example.ac.kr"],
    ]);
    expect(res.columns.dropped.map((d) => d.header)).toEqual(expect.arrayContaining(["주관기관 대표전화", "법인등록번호"]));
    expect(JSON.stringify(res.projects)).not.toMatch(/110111-|02-30\d\d/);
    // 같은 메일을 이 형식의 현황으로 분류해도 결과가 같다
    const again = matchAll(first, res.projects, DEFAULT_SETTINGS);
    const base = matchAll(first, projects, DEFAULT_SETTINGS);
    expect(again.map((x) => [x.status, x.projectId])).toEqual(base.map((x) => [x.status, x.projectId]));
  });
});
