import { listDepts, publicDept } from "@/lib/server/depts";
import { setupProblems } from "@/lib/server/setup";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    depts: (await listDepts()).map(publicDept),
    adminEnabled: !!process.env.ADMIN_PASSWORD,
    setup: setupProblems(),
  });
}
