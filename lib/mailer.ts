// 서버 전용: 독촉 메일 실제 발송 (SMTP)
// 안전장치: 허용 목록(EMAIL_ALLOWED_RECIPIENTS)에 있는 주소로만 보낸다.
import nodemailer, { type Transporter } from "nodemailer";

export interface MailerStatus {
  enabled: boolean;
  from: string;
  allowAll: boolean;
  allowedHint: string;
}

function allowRules(): string[] {
  return (process.env.EMAIL_ALLOWED_RECIPIENTS || "")
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(addr: string, rules = allowRules()): boolean {
  const a = addr.toLowerCase();
  return rules.some((r) => r === "*" || r === a || (r.startsWith("@") && a.endsWith(r)));
}

export function mailerStatus(): MailerStatus {
  const enabled = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
  const rules = allowRules();
  return {
    enabled,
    from: enabled ? `${process.env.EMAIL_FROM_NAME || "KIAT 국제협력전략실"} <${process.env.SMTP_USER}>` : "",
    allowAll: rules.includes("*"),
    allowedHint: rules.length ? (rules.includes("*") ? "모든 주소" : `${rules.length}개 주소·도메인`) : "없음",
  };
}

let transport: Transporter | null = null;
function getTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 465);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

export function resetTransportForTest() {
  transport = null;
}

export interface OutMail {
  to: string[];
  subject: string;
  text: string;
}

export async function sendMail(m: OutMail): Promise<void> {
  const st = mailerStatus();
  if (!st.enabled) throw new Error("메일 발송 설정(SMTP)이 없습니다.");
  const blocked = m.to.filter((t) => !isAllowed(t));
  if (blocked.length) throw new Error(`허용 목록에 없는 주소라 보내지 않았습니다: ${blocked.join(", ")}`);
  await getTransport().sendMail({
    from: st.from,
    to: m.to.join(", "),
    replyTo: process.env.EMAIL_REPLY_TO || undefined,
    subject: m.subject,
    text: m.text,
  });
}
