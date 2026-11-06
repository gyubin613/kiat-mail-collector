import { bad, member, readJson } from "@/lib/server/http";
import { resetDept, snapshot } from "@/lib/server/ledger";
import { publicDept } from "@/lib/server/depts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  return Response.json(await snapshot(publicDept(m.dept), m.user));
}

/** 접수대장 비우기 (체험용 실이거나 확인 문구를 넣었을 때만) */
export async function DELETE(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  const body = await readJson<{ confirm?: string }>(req);
  if (!m.dept.demo && body?.confirm !== `${m.dept.name} 초기화`) return bad(`확인 문구 '${m.dept.name} 초기화'를 정확히 입력해 주세요.`);
  await resetDept(m.dept.code);
  return Response.json({ ok: true });
}
