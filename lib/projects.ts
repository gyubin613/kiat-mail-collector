// 과제관리 현황 엑셀 → 과제·기관 목록
// - 기관별로 한 줄씩인 표(세로형)와 과제별로 한 줄인 표(가로형)를 모두 읽는다.
// - 분류·독촉에 필요한 열만 가져오고, 전화번호·주소·법인/사업자번호 같은 열은 아예 읽지 않는다.
import type { Institution, InstitutionRole, Project } from "./types";

type Field =
  | "id"
  | "name"
  | "nameEn"
  | "orgName"
  | "role"
  | "leadOrg"
  | "partnerOrg"
  | "country"
  | "contactName"
  | "manager"
  | "year";

const ALIASES: Record<Field, string[]> = {
  id: ["과제번호", "과제코드", "과제id", "projectno", "projectid", "projectnumber"],
  name: ["과제명", "과제제목", "과제이름", "국문과제명", "과제명국문", "과제제목국문", "projectname", "projecttitle", "title"],
  nameEn: ["과제명영문", "과제제목영문", "영문과제명", "영문과제제목", "과제영문명", "영문명", "englishtitle", "projecttitleen", "titleen"],
  orgName: ["기관명", "기관", "수행기관", "수행기관명", "organization", "institution", "organisation"],
  role: ["구분", "기관구분", "역할", "기관역할", "참여형태", "참여구분", "role"],
  leadOrg: ["주관기관", "주관기관명", "주관연구기관", "lead", "leadorganization"],
  partnerOrg: ["참여기관", "참여기관명", "해외기관", "해외기관명", "해외참여기관", "공동연구기관", "공동연구기관명", "partner", "partnerorganization"],
  country: ["국가", "국가명", "소재국", "country"],
  contactName: ["책임연구자", "연구책임자", "책임자", "책임연구자명", "담당자명", "참여연구자", "pi", "contact", "contactname"],
  manager: ["kiat담당자", "담당자", "전담자", "과제담당자", "담당pm", "pm", "manager"],
  year: ["연차", "연도", "년도", "협약연도", "사업연도", "year"],
};

const PHONE_HEADER = /전화|연락처|휴대|핸드폰|팩스|fax|phone|tel|mobile/i;
const EMAIL_HEADER = /이메일|메일|e-?mail/i;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** 셀 안에 섞여 있는 전화번호 (국내·국제 형식) */
const PHONE_RE = /\(0\d{1,2}\)\s?\d{3,4}[\s.-]\d{4}|(\+\d{1,3}[\s.-]?)?0?\d{1,3}[\s.-]?\d{3,4}[\s.-]\d{4}/g;

const key = (h: string) => (h || "").normalize("NFKC").toLowerCase().replace(/[\s()[\]{}_\-./·:]/g, "");

export interface ColumnReport {
  used: { header: string; as: string }[];
  dropped: { header: string; reason: string }[];
}

const FIELD_LABEL: Record<Field, string> = {
  id: "과제번호",
  name: "과제명",
  nameEn: "영문 과제명",
  orgName: "기관명",
  role: "기관 구분",
  leadOrg: "주관기관",
  partnerOrg: "참여기관",
  country: "국가",
  contactName: "받는 사람 이름",
  manager: "KIAT 담당자",
  year: "연도",
};

interface Layout {
  field: Partial<Record<Field, number>>;
  emails: { idx: number; side: "lead" | "partner" | "any" }[];
  report: ColumnReport;
}

export function detectLayout(headers: string[]): Layout {
  const field: Layout["field"] = {};
  const emails: Layout["emails"] = [];
  const report: ColumnReport = { used: [], dropped: [] };
  headers.forEach((raw, idx) => {
    const h = (raw || "").trim();
    if (!h) return;
    const k = key(h);
    if (EMAIL_HEADER.test(h)) {
      const side = /주관|lead/i.test(h) ? "lead" : /참여|해외|공동|partner|foreign/i.test(h) ? "partner" : "any";
      emails.push({ idx, side });
      report.used.push({ header: h, as: "이메일" });
      return;
    }
    if (PHONE_HEADER.test(h)) {
      report.dropped.push({ header: h, reason: "개인정보(전화번호)라 읽지 않음" });
      return;
    }
    for (const [f, aliases] of Object.entries(ALIASES) as [Field, string[]][]) {
      if (field[f] === undefined && aliases.includes(k)) {
        field[f] = idx;
        report.used.push({ header: h, as: FIELD_LABEL[f] });
        return;
      }
    }
    report.dropped.push({ header: h, reason: "분류·독촉에 쓰지 않아 읽지 않음" });
  });
  return { field, emails, report };
}

function scrub(v: string): string {
  return (v || "")
    .replace(PHONE_RE, "")
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/\s*[/,]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function emailsIn(v: string): string[] {
  return [...new Set((scrub(v).match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))];
}

function isForeign(country: string, name: string, emails: string[]): boolean {
  if (country) return !/^(한국|대한민국|국내|korea|south korea|republic of korea|kr|kor)$/i.test(country.trim());
  if (/[가-힣]/.test(name)) return false;
  if (emails.length && emails.every((e) => e.endsWith(".kr"))) return false;
  return true;
}

function splitList(v: string): string[] {
  return scrub(v)
    .split(/\n|;|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface ImportResult {
  projects: Project[];
  warnings: string[];
  columns: ColumnReport;
  format: "기관별" | "과제별" | "";
}

/** 머리글 + 데이터 행(문자열 2차원 배열) → 과제·기관 목록 */
export function rowsToProjects(rows: string[][]): ImportResult {
  const warnings: string[] = [];
  const empty: ColumnReport = { used: [], dropped: [] };
  if (rows.length < 2) return { projects: [], warnings: ["과제 목록에 데이터 행이 없습니다."], columns: empty, format: "" };
  const headerIdx = rows.slice(0, 15).findIndex((r) => {
    const l = detectLayout(r);
    return l.field.id !== undefined && l.field.name !== undefined;
  });
  if (headerIdx < 0) {
    return {
      projects: [],
      warnings: ["'과제번호'와 '과제명(과제제목)' 열을 찾지 못했습니다. 열 이름이 있는 행이 있는지 확인해 주세요."],
      columns: empty,
      format: "",
    };
  }
  const layout = detectLayout(rows[headerIdx]);
  const { field } = layout;
  const get = (r: string[], f: Field) => {
    const i = field[f];
    if (i === undefined) return "";
    const v = String(r[i] ?? "").trim();
    return f === "id" ? v : scrub(v);
  };
  const rowEmails = (r: string[], side?: "lead" | "partner" | "any") =>
    [...new Set(layout.emails.filter((e) => !side || e.side === side).flatMap((e) => emailsIn(String(r[e.idx] ?? ""))))];

  const longFormat = field.orgName !== undefined;
  const byId = new Map<string, { project: Project; order: number }>();
  let roleGuessed = false;

  const ensureProject = (r: string[], id: string) => {
    let entry = byId.get(id);
    if (!entry) {
      entry = {
        order: byId.size,
        project: {
          id,
          name: get(r, "name"),
          nameEn: get(r, "nameEn"),
          leadOrg: "",
          partnerOrg: "",
          country: "",
          manager: get(r, "manager"),
          year: get(r, "year"),
          contacts: [],
          partnerContacts: [],
          institutions: [],
        },
      };
      byId.set(id, entry);
    } else {
      const p = entry.project;
      p.name ||= get(r, "name");
      p.nameEn ||= get(r, "nameEn");
      p.manager ||= get(r, "manager");
      p.year ||= get(r, "year");
    }
    return entry.project;
  };

  const addInstitution = (p: Project, inst: Omit<Institution, "key" | "projectId" | "foreign">) => {
    if (!inst.name) return;
    const k = `${p.id}::${inst.name}`;
    const existing = p.institutions.find((i) => i.key === k);
    if (existing) {
      existing.emails = [...new Set([...existing.emails, ...inst.emails])];
      existing.contactName ||= inst.contactName;
      existing.country ||= inst.country;
      if (inst.role === "주관기관") existing.role = "주관기관";
      existing.foreign = isForeign(existing.country, existing.name, existing.emails);
      return;
    }
    p.institutions.push({
      ...inst,
      key: k,
      projectId: p.id,
      foreign: isForeign(inst.country, inst.name, inst.emails),
    });
  };

  for (const r of rows.slice(headerIdx + 1)) {
    const id = get(r, "id");
    if (!id) continue;
    const p = ensureProject(r, id);
    if (longFormat) {
      const org = get(r, "orgName");
      const roleText = get(r, "role");
      const lead = get(r, "leadOrg");
      let role: InstitutionRole;
      if (roleText) role = /주관|lead|host/i.test(roleText) ? "주관기관" : "참여기관";
      else if (lead) role = lead === org ? "주관기관" : "참여기관";
      else {
        role = p.institutions.length === 0 ? "주관기관" : "참여기관";
        roleGuessed = true;
      }
      addInstitution(p, { name: org, role, country: get(r, "country"), contactName: get(r, "contactName"), emails: rowEmails(r) });
    } else {
      const leadName = get(r, "leadOrg");
      if (leadName) {
        addInstitution(p, {
          name: leadName,
          role: "주관기관",
          country: "",
          contactName: layout.emails.some((e) => e.side === "partner") ? "" : get(r, "contactName"),
          emails: [...rowEmails(r, "lead"), ...rowEmails(r, "any")],
        });
      }
      const partners = splitList(field.partnerOrg !== undefined ? String(r[field.partnerOrg] ?? "") : "");
      const pEmails = rowEmails(r, "partner");
      const countries = splitList(field.country !== undefined ? String(r[field.country] ?? "") : "");
      partners.forEach((name, i) => {
        const own =
          partners.length === pEmails.length ? [pEmails[i]] : partners.length === 1 ? pEmails : i === partners.length - 1 ? pEmails.slice(i) : pEmails[i] ? [pEmails[i]] : [];
        addInstitution(p, {
          name,
          role: "참여기관",
          country: countries[i] ?? countries[0] ?? "",
          contactName: partners.length === 1 ? get(r, "contactName") : "",
          emails: own.filter(Boolean),
        });
      });
    }
  }

  const projects = [...byId.values()].sort((a, b) => a.order - b.order).map((e) => e.project);
  for (const p of projects) {
    const lead = p.institutions.find((i) => i.role === "주관기관");
    const partners = p.institutions.filter((i) => i.role === "참여기관");
    const mainPartner = partners.find((i) => i.foreign) ?? partners[0];
    p.leadOrg = lead?.name ?? "";
    p.partnerOrg = mainPartner?.name ?? "";
    p.country = mainPartner?.country ?? "";
    p.contacts = [...new Set(p.institutions.flatMap((i) => i.emails))];
    p.partnerContacts = [...new Set(partners.flatMap((i) => i.emails))];
    if (!p.institutions.length) warnings.push(`과제 ${p.id}에 기관 정보가 없습니다.`);
  }
  if (roleGuessed) warnings.push("기관 구분(주관/참여) 열이 없어 과제별 첫 번째 기관을 주관기관으로 보았습니다.");
  if (!layout.emails.length) warnings.push("이메일 열을 찾지 못했습니다. 발신자로 과제를 찾을 수 없고 독촉 메일 주소도 비게 됩니다.");
  const noMail = projects.flatMap((p) => p.institutions).filter((i) => !i.emails.length).length;
  if (layout.emails.length && noMail) warnings.push(`이메일이 없는 기관이 ${noMail}곳 있습니다.`);
  return { projects, warnings, columns: layout.report, format: longFormat ? "기관별" : "과제별" };
}

export function allInstitutions(projects: Project[]): Institution[] {
  return projects.flatMap((p) => p.institutions);
}
