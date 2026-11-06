"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

interface DeptRow {
  code: string;
  name: string;
  demo: boolean;
  createdAt: string;
}

export function Admin({ onLogout }: { onLogout: () => void }) {
  const [depts, setDepts] = useState<DeptRow[]>([]);
  const [form, setForm] = useState({ code: "", name: "", password: "" });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = () =>
    api<{ depts: DeptRow[] }>("/api/admin/depts")
      .then((d) => setDepts(d.depts))
      .catch((e) => setErr((e as Error).message));
  useEffect(() => {
    load();
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    setMsg("");
    try {
      const r = await api<{ dept: DeptRow }>("/api/admin/depts", { body: form });
      setMsg(`${r.dept.name}(${r.dept.code})을(를) 저장했습니다.${form.password ? " 새 비밀번호를 실 담당자들에게 알려 주세요." : ""}`);
      setForm({ code: "", name: "", password: "" });
      load();
    } catch (e2) {
      setErr((e2 as Error).message);
    }
  };

  const remove = async (d: DeptRow) => {
    if (!window.confirm(`${d.name} 실을 목록에서 지웁니다. 계속할까요?`)) return;
    await api(`/api/admin/depts?code=${encodeURIComponent(d.code)}`, { method: "DELETE" }).catch((e) => setErr((e as Error).message));
    load();
  };

  return (
    <main className="admin">
      <header className="admin-head">
        <h1 className="title">실 관리</h1>
        <button className="btn" onClick={onLogout}>
          나가기
        </button>
      </header>
      <p className="subtitle">실마다 접수대장이 따로 저장됩니다. 실 비밀번호는 그 실 담당자들이 함께 씁니다. 운영 단계에서는 기관 통합 로그인으로 바꾸는 것을 전제로 합니다.</p>
      <table className="matrix" style={{ marginTop: 12 }}>
        <thead>
          <tr>
            <th>실 코드</th>
            <th>실 이름</th>
            <th>만든 날</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {depts.map((d) => (
            <tr key={d.code}>
              <td className="num">{d.code}</td>
              <td>{d.name}</td>
              <td className="num">{d.createdAt ? d.createdAt.slice(0, 10) : "기본 제공"}</td>
              <td>
                {!d.demo && (
                  <>
                    <button className="btn small" onClick={() => setForm({ code: d.code, name: d.name, password: "" })}>
                      이름·비밀번호 바꾸기
                    </button>{" "}
                    <button className="btn small" onClick={() => remove(d)}>
                      지우기
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form className="admin-form" onSubmit={save}>
        <h2>실 추가 또는 바꾸기</h2>
        <label>
          실 코드
          <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="예: INTL" required />
        </label>
        <label>
          실 이름
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 국제협력전략실" required />
        </label>
        <label>
          실 비밀번호 {depts.some((d) => d.code === form.code) && <small>(비워 두면 그대로)</small>}
          <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} autoComplete="new-password" />
        </label>
        <button className="btn primary" type="submit">
          저장
        </button>
        {msg && <p className="ok-msg">{msg}</p>}
        {err && <p className="field-err">{err}</p>}
      </form>
    </main>
  );
}
