import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { setAuthed } from "../auth";

const DEFAULT_PASSWORD = "1009"; 

export default function Unlock() {
  const nav = useNavigate();
  const loc = useLocation() as any;

  const redirectTo = useMemo(() => {
    const from = loc?.state?.from;
    return typeof from === "string" ? from : "/dashboard";
  }, [loc]);

  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");

    if (pw === DEFAULT_PASSWORD) {
      setAuthed(true);
      nav(redirectTo, { replace: true });
      return;
    }

    setErr("Şifre yanlış.");
  };

  return (
    <div style={{ padding: 16, fontFamily: "system-ui", maxWidth: 420 }}>
      <h2 style={{ marginTop: 0 }}>🔒 Şifre Gerekli</h2>
      <div style={{ opacity: 0.7, marginBottom: 12 }}>
        Bu sayfaya erişmek için şifre gir.
      </div>

      <form onSubmit={onSubmit}>
        <input
          type="password"
          placeholder="Şifre"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          autoFocus
        />
        {err && <div style={{ color: "crimson", marginTop: 10 }}>{err}</div>}

        <button
          type="submit"
          style={{
            marginTop: 12,
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid #ddd",
            cursor: "pointer",
          }}
        >
          Giriş
        </button>
      </form>
    </div>
  );
}