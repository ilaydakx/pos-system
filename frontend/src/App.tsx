import React, { useEffect } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import { isAuthed, logout, startIdleWatch } from "./auth";

const navLinkStyle = ({ isActive }: { isActive: boolean }) => {
  const base: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 12,
    textDecoration: "none",
    fontWeight: 600,
    color: "#1f2937",
    background: "transparent",
    border: "1px solid transparent",
    transition: "all 150ms ease",
  };

  if (!isActive) return base;

  return {
    ...base,
    background: "#111827",
    color: "#ffffff",
    boxShadow: "0 6px 18px rgba(17,24,39,0.15)",
  };
};

const dotStyle = (active: boolean): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: 999,
  background: active ? "#fff" : "rgba(17,24,39,0.25)",
});

function NavItem({ to, label, end }: { to: string; label: string; end?: boolean }) {
  return (
    <NavLink to={to} end={end} style={navLinkStyle}>
      {({ isActive }) => (
        <>
          <span style={dotStyle(isActive)} />
          <span>{label}</span>
        </>
      )}
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
        gridTemplateColumns: "260px 1fr",
        minHeight: "100vh",
        background: "#faf7f5",
        fontFamily: "system-ui",
      }}
    >
      <aside
        style={{
          background: "#ffffff",
          borderRight: "1px solid rgba(17,24,39,0.08)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {/* Logo */}
        <div
          style={{
            fontWeight: 800,
            fontSize: 20,
            padding: "10px 12px",
            borderRadius: 14,
            background: "linear-gradient(135deg, #fde68a, #fbcfe8)",
            color: "#111827",
            marginBottom: 6,
          }}
        >
          CIEL POS
        </div>

        <nav style={{ display: "grid", gap: 8 }}>
          <NavItem to="/" label="Satış" end />
          <NavItem to="/stockcontrol" label="Stok Kontrol" />
          <NavItem to="/products" label="Ürünler" />
          <NavItem to="/transfer" label="Ürün Transferi" />
          <NavItem to="/returns" label="İade / Değişim" />
          <NavItem to="/soldproducts" label="Satılan Ürünler" />
          <NavItem to="/dashboard" label="Dashboard" />
          <NavItem to="/expenses" label="Gider" />
          <NavItem to="/barcode-print" label="Barkod Yazdır" />
          <NavItem to="/settings" label="Ayarlar" />
        </nav>

        <div style={{ marginTop: "auto" }}>
          {isAuthed() ? (
            <button
              onClick={() => {
                logout();
                nav("/unlock", { replace: true, state: { from: loc.pathname } });
              }}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(17,24,39,0.15)",
                background: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Çıkış
            </button>
          ) : (
            <button
              onClick={() => nav("/unlock", { replace: true })}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(17,24,39,0.15)",
                background: "#fff",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Kilidi Aç
            </button>
          )}
        </div>
      </aside>

      <main style={{ flex: 1, padding: 16, background: "#fbf6f3", minHeight: "100vh" }}>
        <Outlet />
      </main>
    </div>
  );
}