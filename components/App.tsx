"use client";
import { useCallback, useEffect, useState } from "react";
import { Admin } from "./Admin";
import { api } from "./api";
import { Login } from "./Login";
import Workspace, { type Me } from "./Workspace";

type Session = { role: "admin" } | ({ role: "member" } & Me) | null;

export default function App() {
  const [session, setSession] = useState<Session | undefined>(undefined);

  const refresh = useCallback(() => {
    api<{ session: Session }>("/api/auth/me")
      .then((r) => setSession(r.session))
      .catch(() => setSession(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (session === undefined) return <div className="empty" style={{ margin: 40 }}>불러오는 중…</div>;
  if (!session) return <Login onDone={refresh} />;
  if (session.role === "admin")
    return (
      <Admin
        onLogout={async () => {
          await api("/api/auth/logout", { body: {} }).catch(() => undefined);
          refresh();
        }}
      />
    );
  return <Workspace key={`${session.dept.code}:${session.user}`} me={{ dept: session.dept, user: session.user }} onLogout={refresh} />;
}
