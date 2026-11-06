import { listDepts, publicDept } from "@/lib/server/depts";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ depts: (await listDepts()).map(publicDept), adminEnabled: !!process.env.ADMIN_PASSWORD });
}
