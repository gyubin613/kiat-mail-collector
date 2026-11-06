import { bad, member, readJson } from "@/lib/server/http";
import { imapConfigured, listMessages } from "@/lib/server/imap";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  if (!imapConfigured()) return bad("수집 메일함(IMAP)이 설정되지 않았습니다.", 503);
  const body = await readJson<{ folder?: string; since?: string }>(req);
  const since = /^\d{4}-\d{2}-\d{2}$/.test(body?.since ?? "") ? new Date(`${body!.since}T00:00:00+09:00`) : new Date(Date.now() - 30 * 86400000);
  try {
    return Response.json({ messages: await listMessages(String(body?.folder || "INBOX").slice(0, 100), since) });
  } catch (e) {
    return bad(`메일함을 읽지 못했습니다: ${(e as Error).message}`, 502);
  }
}
