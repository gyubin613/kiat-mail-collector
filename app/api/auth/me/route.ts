import { getSession } from "@/lib/server/auth";
import { getDept, publicDept } from "@/lib/server/depts";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = getSession(req);
  if (!s) return Response.json({ session: null });
  if (s.role === "admin") return Response.json({ session: { role: "admin" } });
  const dept = s.dept ? await getDept(s.dept) : null;
  if (!dept) return Response.json({ session: null });
  return Response.json({ session: { role: "member", dept: publicDept(dept), user: s.user } });
}
