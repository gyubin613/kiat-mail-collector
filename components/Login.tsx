"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

interface DeptInfo {
  code: string;
  name: string;
  demo: boolean;
}

interface SetupProblem {
  key: string;
  message: string;
}

export function Login({ onDone, notice }: { onDone: () => void; notice?: string }) {
  const [setup, setSetup] = useState<SetupProblem[]>([]);
  const [depts, setDepts] = useState<DeptInfo[]>([]);
  const [adminEnabled, setAdminEnabled] = useState(false);
  const [mode, setMode] = useState<"member" | "admin">("member");
  const [dept, setDept] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ depts: DeptInfo[]; adminEnabled: boolean; setup?: SetupProblem[] }>("/api/auth/depts")
      .then((d) => {
        setDepts(d.depts);
        setAdminEnabled(d.adminEnabled);
        setSetup(d.setup ?? []);
        setDept((cur) => cur || d.depts.find((x) => !x.demo)?.code || d.depts[0]?.code || "");
      })
      .catch((e) => setError((e as Error).message));
    try {
      setUser(localStorage.getItem("kmc-user") || "");
    } catch {
      /* 무시 */
    }
  }, []);

  const current = depts.find((d) => d.code === dept);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "admin") {
        await api("/api/auth/admin", { body: { password } });
      } else {
        await api("/api/auth/login", { body: { dept, user, password } });
        try {
          localStorage.setItem("kmc-user", user);
        } catch {
          /* 무시 */
        }
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <h1 className="title">과제 서류 메일 정리 도우미</h1>
        <p className="subtitle">K-PASS 밖에서 메일로 받는 과제 서류를 실별 접수대장으로 관리합니다.</p>
        {setup.length > 0 && (
          <div className="setup-alert" role="alert">
            <b>배포 설정이 끝나지 않았습니다</b>
            <ul>
              {setup.map((p) => (
                <li key={p.key}>{p.message}</li>
              ))}
            </ul>
            <p>
              Vercel 프로젝트의 Settings → Environment Variables에 {setup.map((p) => (p.key === "UPSTASH_REDIS_REST_URL" ? "UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN" : p.key)).join(", ")}을(를) 넣고 Redeploy 해 주세요.
            </p>
          </div>
        )}
        {notice && !setup.length && <p className="note">{notice}</p>}

        {mode === "member" ? (
          <>
            <label>
              실
              <select value={dept} onChange={(e) => setDept(e.target.value)} required>
                {depts.map((d) => (
                  <option key={d.code} value={d.code}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              담당자 이름
              <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="예: 김OO" required maxLength={40} />
              <small>작업 기록과 인수인계서에 이 이름이 남습니다.</small>
            </label>
            {!current?.demo && (
              <label>
                실 비밀번호
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </label>
            )}
            {current?.demo && <p className="note">체험용 실은 비밀번호 없이 들어갑니다. 실제 자료는 올리지 마세요.</p>}
          </>
        ) : (
          <label>
            관리자 비밀번호
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
            <small>실을 만들고 실 비밀번호를 정하는 화면입니다. 서류 내용은 볼 수 없습니다.</small>
          </label>
        )}

        {error && <p className="field-err">{error}</p>}
        <button className="btn primary" type="submit" disabled={busy || (mode === "member" && !dept)}>
          {busy ? "확인하는 중…" : mode === "member" ? "들어가기" : "관리자로 들어가기"}
        </button>
        {adminEnabled && (
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setMode(mode === "member" ? "admin" : "member");
              setPassword("");
              setError("");
            }}
          >
            {mode === "member" ? "실 관리(관리자)" : "실 담당자로 들어가기"}
          </button>
        )}
      </form>
    </main>
  );
}
