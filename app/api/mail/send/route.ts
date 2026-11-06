import { checkAccess } from "@/lib/ai/guard";
import { mailerStatus, sendMail } from "@/lib/mailer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface SendRequest {
  messages: { id: string; to: string[]; subject: string; body: string }[];
  /** 있으면 실제 받는 사람 대신 이 주소로 시험 발송 */
  testTo?: string;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: Request) {
  const denied = checkAccess(req);
  if (denied) return denied;
  if (!mailerStatus().enabled) return Response.json({ error: "메일 발송 설정(SMTP)이 없습니다." }, { status: 503 });
  let body: SendRequest;
  try {
    body = (await req.json()) as SendRequest;
  } catch {
    return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  if (!Array.isArray(body?.messages) || !body.messages.length) {
    return Response.json({ error: "보낼 메일이 없습니다." }, { status: 400 });
  }
  if (body.messages.length > 60) return Response.json({ error: "한 번에 60통까지 보낼 수 있습니다." }, { status: 400 });
  const testTo = body.testTo?.trim().toLowerCase();
  if (testTo && !EMAIL.test(testTo)) return Response.json({ error: "시험 발송 주소가 올바르지 않습니다." }, { status: 400 });

  const results: { id: string; ok: boolean; sentTo: string[]; error?: string }[] = [];
  for (const m of body.messages) {
    const to = testTo ? [testTo] : (m.to ?? []).map((t) => String(t).trim().toLowerCase()).filter((t) => EMAIL.test(t)).slice(0, 10);
    if (!to.length) {
      results.push({ id: m.id, ok: false, sentTo: [], error: "받는 사람 주소가 없습니다." });
      continue;
    }
    try {
      await sendMail({
        to,
        subject: `${testTo ? "[시험 발송] " : ""}${String(m.subject ?? "").slice(0, 300)}`,
        text: String(m.body ?? "").slice(0, 10000),
      });
      results.push({ id: m.id, ok: true, sentTo: to });
    } catch (e) {
      results.push({ id: m.id, ok: false, sentTo: to, error: (e as Error).message });
    }
  }
  return Response.json({ results });
}
