import { bad, member, readJson } from "@/lib/server/http";
import { addMails, updateMail } from "@/lib/server/ledger";

export const dynamic = "force-dynamic";

/** 새 메일 기록 (이미 있는 메일은 건너뜀) */
export async function POST(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  const body = await readJson<{ mails?: unknown[] }>(req);
  if (!Array.isArray(body?.mails)) return bad("메일 기록이 없습니다.");
  return Response.json(await addMails(m.dept.code, m.user, body!.mails));
}

/** 분류 결과 고치기: { updates: [{ key, result }] } */
export async function PATCH(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  const body = await readJson<{ updates?: { key: string; result: unknown }[] }>(req);
  if (!Array.isArray(body?.updates)) return bad("고칠 내용이 없습니다.");
  const updated: string[] = [];
  for (const u of body!.updates.slice(0, 200)) {
    if (await updateMail(m.dept.code, String(u.key), u.result)) updated.push(String(u.key));
  }
  return Response.json({ updated });
}
