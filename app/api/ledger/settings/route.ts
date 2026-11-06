import { member, readJson } from "@/lib/server/http";
import { saveSettings } from "@/lib/server/ledger";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  return Response.json(await saveSettings(m.dept.code, await readJson(req)));
}
