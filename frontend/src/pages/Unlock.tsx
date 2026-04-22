import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { setAuthed } from "../auth";
import { LS_PASSWORD, DEFAULT_PASSWORD } from "./Settings";
import { C, R, page, input, btnPrimary, errBox } from "../lib/ds";

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

    const current = localStorage.getItem(LS_PASSWORD) ?? DEFAULT_PASSWORD;
    if (pw === current) {
      setAuthed(true);
      nav(redirectTo, { replace: true });
      return;
    }

    setErr("Şifre yanlış.");
  };

  return (
    <div
      style={{
        ...page,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          width: 360,
          backgroundColor: C.canvas,
          border: `1px solid ${C.border}`,
          borderRadius: R.xl,
          padding: "32px 28px",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 700, color: C.ink, marginBottom: 4 }}>
          Şifre Gerekli
        </div>
        <div style={{ fontSize: 14, color: C.ink3, marginBottom: 24 }}>
          Bu sayfaya erişmek için şifre gir.
        </div>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
          <input
            type="password"
            placeholder="Şifre"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            style={input}
            autoFocus
          />

          {err && <div style={errBox}>{err}</div>}

          <button type="submit" style={btnPrimary}>
            Giriş
          </button>
        </form>
      </div>
    </div>
  );
}
