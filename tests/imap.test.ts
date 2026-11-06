import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import JSZip from "jszip";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as fetchRoute } from "../app/api/imap/fetch/route";
import { POST as listRoute } from "../app/api/imap/list/route";
import { parseEml } from "../lib/mail";
import { memberCookie } from "./helpers";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const hoodiecrow = require("hoodiecrow-imap");

let server: { listen: (p: number, cb: () => void) => void; close: (cb?: () => void) => void; server?: { address(): AddressInfo } };
let rawFirst = "";

beforeAll(async () => {
  const zip = await JSZip.loadAsync(readFileSync(join(__dirname, "..", "public", "samples", "가상메일.zip")));
  const names = Object.keys(zip.files).sort().slice(0, 6);
  const messages = [];
  for (const n of names) {
    const raw = await zip.file(n)!.async("string");
    if (!rawFirst) rawFirst = raw;
    messages.push({ raw, internaldate: "01-Dec-2026 10:00:00 +0900" });
  }
  // 큰 메일 하나 (보낼 수 있는 크기 초과)
  messages.push({ raw: `Subject: big\r\nMessage-ID: <big@x>\r\nFrom: a@b.example\r\nDate: Tue, 01 Dec 2026 10:00:00 +0900\r\n\r\n${"x".repeat(3.7 * 1024 * 1024)}`, internaldate: "01-Dec-2026 10:00:00 +0900" });
  server = hoodiecrow({
    plugins: ["ID", "AUTH-PLAIN", "UIDPLUS", "ENABLE", "UNSELECT", "ESEARCH"],
    storage: { INBOX: { messages }, "": { separator: "/", folders: { "KIAT-INTL": { messages: messages.slice(0, 2) } } } },
    users: { collector: { password: "pw" } },
  });
  const port = 14300 + Math.floor(Math.random() * 500);
  await new Promise<void>((r) => server.listen(port, r));
  Object.assign(process.env, { IMAP_HOST: "127.0.0.1", IMAP_PORT: String(port), IMAP_USER: "collector", IMAP_PASS: "pw" });
});
afterAll(() => {
  server.close();
  for (const k of ["IMAP_HOST", "IMAP_PORT", "IMAP_USER", "IMAP_PASS"]) delete process.env[k];
});

const call = (fn: (r: Request) => Promise<Response>, body: unknown, headers = memberCookie()) =>
  fn(new Request("http://x/api/imap", { method: "POST", headers, body: JSON.stringify(body) }));

describe("수집 메일함 가져오기", () => {
  it("폴더의 메일 목록을 읽는다", async () => {
    const res = await call(listRoute, { folder: "INBOX", since: "2026-11-01" });
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.messages).toHaveLength(7);
    expect(data.messages[0]).toHaveProperty("messageId");
    const intl = await (await call(listRoute, { folder: "KIAT-INTL", since: "2026-11-01" })).json();
    expect(intl.messages).toHaveLength(2);
  });

  it("원문을 가져오고, 너무 큰 메일은 따로 알려준다", async () => {
    const list = (await (await call(listRoute, { folder: "INBOX", since: "2026-11-01" })).json()).messages as { uid: number; subject: string }[];
    const res = await call(fetchRoute, { folder: "INBOX", uids: list.map((m) => m.uid) });
    const data = await res.json();
    expect(data.items.length).toBe(6);
    expect(data.tooLarge).toHaveLength(1);
    const parsed = await parseEml(new Uint8Array(Buffer.from(data.items[0].raw, "base64")), "imap.eml", "");
    expect(parsed.attachments.length).toBeGreaterThan(0);
  });

  it("로그인하지 않으면 막는다", async () => {
    expect((await call(listRoute, {}, {})).status).toBe(401);
  });
});
