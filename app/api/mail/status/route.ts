import { mailerStatus } from "@/lib/mailer";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ ...mailerStatus(), passwordRequired: !!process.env.APP_PASSWORD });
}
