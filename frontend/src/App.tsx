import React, { useEffect } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { isAuthed, logout, startIdleWatch } from "./auth";
import { C, R } from "./lib/ds";

const navLinkStyle = ({ isActive }: { isActive: boolean }) => {
  const base: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: R.md,
    textDecoration: "none",
    fontSize: 14,
    fontWeight: 500,
    color: C.ink2,
    background: "transparent",
    transition: "all 120ms ease",
  };

  if (!isActive) return base;

  return {
    ...base,
    background: C.ink,
    color: "#ffffff",
    fontWeight: 600,
  };
};

function NavItem({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} style={navLinkStyle}>
      {label}
    </NavLink>
  );
}

export default function App() {
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    const stop = startIdleWatch(() => {
      const p = loc.pathname;
      const protectedPaths = ["/dashboard", "/expenses"];
      const isProtected = protectedPaths.some((x) => p === x || p.startsWith(x + "/"));
      if (isProtected && !isAuthed()) {
        nav("/unlock", { replace: true, state: { from: p } });
      }
    });
    return stop;
  }, [loc.pathname, nav]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "212px minmax(0, 1fr)",
        minHeight: "100vh",
        backgroundColor: C.bg,
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <aside
        style={{
          backgroundColor: C.canvas,
          borderRight: `1px solid ${C.border}`,
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
          position: "sticky",
          top: 0,
          height: "100vh",
          overflowY: "auto",
          boxSizing: "border-box",
        }}
      >
        {/* Logo */}
        <div
          style={{
            fontWeight: 700,
            fontSize: 16,
            letterSpacing: "0.04em",
            padding: "10px 12px",
            color: C.ink,
            marginBottom: 8,
            borderBottom: `1px solid ${C.border}`,
          }}
        >
          CIEL POS
        </div>

        <nav style={{ display: "grid", gap: 2 }}>
          <NavItem to="/" label="Satış" end />
          <NavItem to="/stockcontrol" label="Stok Kontrol" />
          <NavItem to="/products" label="Ürünler" />
          <NavItem to="/transfer" label="Ürün Transferi" />
          <NavItem to="/returns" label="İade / Değişim" />
          <NavItem to="/soldproducts" label="Satılan Ürünler" />
          <NavItem to="/dashboard" label="Dashboard" />
          <NavItem to="/analytics" label="Analiz" />
          <NavItem to="/expenses" label="Gider" />
          <NavItem to="/barcode-print" label="Barkod Yazdır" />
          <NavItem to="/settings" label="Ayarlar" />
        </nav>

        <div style={{ marginTop: "auto", paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
          {isAuthed() ? (
            <button
              onClick={() => {
                logout();
                nav("/unlock", { replace: true, state: { from: loc.pathname } });
              }}
              style={{
                width: "100%",
                padding: "8px 12px",
                height: 36,
                borderRadius: R.md,
                border: `1px solid ${C.border}`,
                backgroundColor: C.canvas,
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
                color: C.ink3,
              }}
            >
              Çıkış
            </button>
          ) : (
            <button
              onClick={() => nav("/unlock", { replace: true })}
              style={{
                width: "100%",
                padding: "8px 12px",
                height: 36,
                borderRadius: R.md,
                border: `1px solid ${C.border}`,
                backgroundColor: C.canvas,
                fontWeight: 500,
                fontSize: 13,
                cursor: "pointer",
                color: C.ink3,
              }}
            >
              Kilidi Aç
            </button>
          )}
        </div>
      </aside>

      <main style={{ backgroundColor: C.bg, minHeight: "100vh", minWidth: 0, overflowY: "auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
