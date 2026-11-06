import { bad, member, readJson } from "@/lib/server/http";
import { saveProjects } from "@/lib/server/ledger";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  const body = await readJson<{ projects?: unknown; sourceName?: string }>(req);
  if (!Array.isArray(body?.projects)) return bad("과제 목록이 없습니다.");
  return Response.json(await saveProjects(m.dept.code, m.user, body!.projects, body!.sourceName ?? ""));
}
