import { bad, member, readJson } from "@/lib/server/http";
import { transferProjects } from "@/lib/server/ledger";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  const body = await readJson<{ from?: string; to?: string; projectIds?: string[] }>(req);
  if (!Array.isArray(body?.projectIds) || !body!.projectIds.length) return bad("넘길 과제를 골라 주세요.");
  try {
    const doc = await transferProjects(m.dept.code, m.user, String(body!.from ?? ""), String(body!.to ?? ""), body!.projectIds.map(String));
    if (!doc) return bad("과제관리 현황이 없습니다.", 404);
    return Response.json(doc);
  } catch (e) {
    return bad((e as Error).message);
  }
}
