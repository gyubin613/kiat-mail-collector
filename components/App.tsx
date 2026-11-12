"use client";
import { useCallback, useEffect, useState } from "react";
import { Admin } from "./Admin";
import { api } from "./api";
import { Login } from "./Login";
import Workspace, { type Me } from "./Workspace";

type Session = { role: "admin" } | ({ role: "member" } & Me) | null;

export default function App() {
  const [session, setSession] = useState<Session | undefined>(undefined);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(() => {
    api<{ session: Session }>("/api/auth/me")
      .then((r) => setSession(r.session))
      .catch(() => setSession(null));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onExpired = () => {
      setNotice("로그인이 풀렸습니다. 다시 로그인해 주세요.");
      setSession(null);
    };
    window.addEventListener("kmc:session-expired", onExpired);
    return () => {
      window.removeEventListener("kmc:session-expired", onExpired);
    };
  }, []);

  if (session === undefined) return <div className="empty" style={{ margin: 40 }}>불러오는 중…</div>;
  if (!session)
    return (
      <Login
        notice={notice}
        onDone={() => {
          setNotice("");
          refresh();
        }}
      />
    );
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
