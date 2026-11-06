import { requireAdmin } from "@/lib/server/auth";
import { deleteDept, listDepts, publicDept, saveDept } from "@/lib/server/depts";
import { bad, readJson } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const a = requireAdmin(req);
  if ("error" in a) return a.error;
  return Response.json({ depts: (await listDepts()).map((d) => ({ ...publicDept(d), createdAt: d.createdAt })) });
}

/** 실 만들기 또는 이름·비밀번호 바꾸기 */
export async function POST(req: Request) {
  const a = requireAdmin(req);
  if ("error" in a) return a.error;
  const body = await readJson<{ code?: string; name?: string; password?: string }>(req);
  try {
    const d = await saveDept({ code: String(body?.code ?? ""), name: String(body?.name ?? ""), password: body?.password || undefined });
    return Response.json({ dept: publicDept(d) });
  } catch (e) {
    return bad((e as Error).message);
  }
}

export async function DELETE(req: Request) {
  const a = requireAdmin(req);
  if ("error" in a) return a.error;
  const code = new URL(req.url).searchParams.get("code") || "";
  if (!code) return bad("실 코드가 필요합니다.");
  await deleteDept(code);
  return Response.json({ ok: true });
}
