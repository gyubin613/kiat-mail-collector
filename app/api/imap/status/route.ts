import { member } from "@/lib/server/http";
import { imapConfigured, imapLabel } from "@/lib/server/imap";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const m = await member(req);
  if (m instanceof Response) return m;
  return Response.json({ configured: imapConfigured(), label: imapLabel() });
}
