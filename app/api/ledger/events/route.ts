import { bad, member, readJson } from "@/lib/server/http";
import { addEvents } from "@/lib/server/ledger";
import type { LedgerEvent } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  const body = await readJson<{ events?: Partial<LedgerEvent>[] }>(req);
  if (!Array.isArray(body?.events)) return bad("기록이 없습니다.");
  return Response.json({ events: await addEvents(m.dept.code, m.user, body!.events) });
}
