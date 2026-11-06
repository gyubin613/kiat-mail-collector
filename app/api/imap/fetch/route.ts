import { bad, member, readJson } from "@/lib/server/http";
import { fetchRaw, imapConfigured } from "@/lib/server/imap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  if (!imapConfigured()) return bad("수집 메일함(IMAP)이 설정되지 않았습니다.", 503);
  const body = await readJson<{ folder?: string; uids?: number[] }>(req);
  const uids = (body?.uids ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!uids.length) return bad("가져올 메일이 없습니다.");
  try {
    return Response.json(await fetchRaw(String(body?.folder || "INBOX").slice(0, 100), uids));
  } catch (e) {
    return bad(`메일을 가져오지 못했습니다: ${(e as Error).message}`, 502);
  }
}
