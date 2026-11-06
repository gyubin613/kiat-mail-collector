// 실(부서) 관리: 실마다 데이터가 분리된다.
import { hashPassword } from "./auth";
import { getStore } from "./store";

export interface Dept {
  code: string;
  name: string;
  /** 비밀번호 해시. 체험용 실은 비어 있음 */
  pwHash: string;
  demo: boolean;
  createdAt: string;
}

export const DEMO_CODE = "DEMO";
const KEY = "kmc:depts";

export function demoEnabled() {
  return process.env.DEMO_DISABLED !== "1";
}

const DEMO: Dept = { code: DEMO_CODE, name: "체험용 실 (가상 데이터)", pwHash: "", demo: true, createdAt: "" };

export async function listDepts(): Promise<Dept[]> {
  const all = Object.values(await getStore().hgetall<Dept>(KEY)).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  return demoEnabled() ? [DEMO, ...all] : all;
}

export async function getDept(code: string): Promise<Dept | null> {
  if (code === DEMO_CODE) return demoEnabled() ? DEMO : null;
  return getStore().hget<Dept>(KEY, code);
}

export const CODE_RE = /^[A-Z0-9_-]{2,20}$/;

export async function saveDept(input: { code: string; name: string; password?: string }): Promise<Dept> {
  const code = input.code.trim().toUpperCase();
  if (!CODE_RE.test(code) || code === DEMO_CODE) throw new Error("실 코드는 영문 대문자·숫자 2~20자로 정해 주세요 (DEMO 제외).");
  const name = input.name.trim().slice(0, 40);
  if (!name) throw new Error("실 이름을 입력해 주세요.");
  const existing = await getStore().hget<Dept>(KEY, code);
  if (!existing && !input.password) throw new Error("새 실에는 비밀번호가 필요합니다.");
  if (input.password && input.password.length < 8) throw new Error("비밀번호는 8자 이상으로 정해 주세요.");
  const dept: Dept = {
    code,
    name,
    pwHash: input.password ? hashPassword(input.password) : existing!.pwHash,
    demo: false,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
  await getStore().hset(KEY, { [code]: dept });
  return dept;
}

export async function deleteDept(code: string) {
  await getStore().hdel(KEY, code);
}

export function publicDept(d: Dept) {
  return { code: d.code, name: d.name, demo: d.demo };
}
