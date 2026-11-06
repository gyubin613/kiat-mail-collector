// 수집 전용 메일함 가져오기 (서버 전용, IMAP)
// 두레이 필터로 대상 메일을 수집 메일함(또는 폴더)으로 자동 전달해 두면, 화면에서 [새 메일 가져오기]로 읽어 온다.
// 메일 원문은 서버에 저장하지 않고 그대로 브라우저로 넘긴다.
import { ImapFlow } from "imapflow";

export interface ImapListItem {
  uid: number;
  messageId: string;
  subject: string;
  from: string;
  date: string;
  size: number;
}

/** 한 번에 브라우저로 넘길 최대 크기 (배포 환경 응답 크기 제한 안쪽) */
export const MAX_BATCH_BYTES = 3.5 * 1024 * 1024;

export function imapConfigured() {
  return !!(process.env.IMAP_HOST && process.env.IMAP_USER && process.env.IMAP_PASS);
}

export function imapLabel() {
  if (!imapConfigured()) return "";
  const u = process.env.IMAP_USER!;
  const at = u.indexOf("@");
  const masked = at > 2 ? `${u.slice(0, 2)}***${u.slice(at)}` : u;
  return `${masked} (${process.env.IMAP_HOST})`;
}

function client() {
  const port = Number(process.env.IMAP_PORT || 993);
  return new ImapFlow({
    host: process.env.IMAP_HOST!,
    port,
    secure: port === 993,
    auth: { user: process.env.IMAP_USER!, pass: process.env.IMAP_PASS! },
    logger: false,
  });
}

async function withMailbox<T>(folder: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
  const c = client();
  await c.connect();
  try {
    const lock = await c.getMailboxLock(folder || "INBOX", { readOnly: true });
    try {
      return await fn(c);
    } finally {
      lock.release();
    }
  } finally {
    await c.logout().catch(() => undefined);
  }
}

export async function listMessages(folder: string, since: Date, limit = 300): Promise<ImapListItem[]> {
  return withMailbox(folder, async (c) => {
    const found = await c.search({ since }, { uid: true });
    const uids = (Array.isArray(found) ? found : []).slice(-limit);
    if (!uids.length) return [];
    const out: ImapListItem[] = [];
    for await (const m of c.fetch(uids, { uid: true, envelope: true, size: true }, { uid: true })) {
      const env = m.envelope;
      out.push({
        uid: m.uid,
        messageId: (env?.messageId || "").trim().replace(/^<|>$/g, "").toLowerCase(),
        subject: env?.subject || "(제목 없음)",
        from: env?.from?.[0]?.address || "",
        date: env?.date ? new Date(env.date).toISOString() : "",
        size: m.size || 0,
      });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  });
}

export async function fetchRaw(
  folder: string,
  uids: number[],
): Promise<{ items: { uid: number; raw: string }[]; tooLarge: { uid: number; size: number }[]; deferred: number[] }> {
  return withMailbox(folder, async (c) => {
    const items: { uid: number; raw: string }[] = [];
    const tooLarge: { uid: number; size: number }[] = [];
    const deferred: number[] = [];
    let total = 0;
    for (const uid of uids.slice(0, 100)) {
      const meta = await c.fetchOne(String(uid), { size: true }, { uid: true });
      const size = (meta && meta.size) || 0;
      if (size > MAX_BATCH_BYTES) {
        tooLarge.push({ uid, size });
        continue;
      }
      if (total + size > MAX_BATCH_BYTES && items.length) {
        deferred.push(uid);
        continue;
      }
      const msg = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (msg && msg.source) {
        items.push({ uid, raw: Buffer.from(msg.source).toString("base64") });
        total += msg.source.length;
      }
    }
    return { items, tooLarge, deferred };
  });
}
