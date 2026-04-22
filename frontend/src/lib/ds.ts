import type { CSSProperties } from "react";

// ─── Color palette ────────────────────────────────────────────────────────────
export const C = {
  bg:           "#F7F6F4",
  canvas:       "#FFFFFF",
  subtle:       "#FAF9F8",
  border:       "#EAE8E5",
  ink:          "#111827",
  ink2:         "#374151",
  ink3:         "#6B7280",
  ink4:         "#9CA3AF",
  accent:       "#111827",
  // semantic
  green:        "#059669",
  greenBg:      "#ECFDF5",
  greenBorder:  "#A7F3D0",
  amber:        "#D97706",
  amberBg:      "#FFFBEB",
  amberBorder:  "#FDE68A",
  rose:         "#DC2626",
  roseBg:       "#FEF2F2",
  roseBorder:   "#FECACA",
} as const;

// ─── Border radius ────────────────────────────────────────────────────────────
export const R = {
  sm:  6,
  md:  10,
  lg:  14,
  xl:  18,
} as const;

// ─── Layout ───────────────────────────────────────────────────────────────────
export const page: CSSProperties = {
  padding: 24,
  backgroundColor: C.bg,
  minHeight: "100%",
  boxSizing: "border-box",
};

// ─── Card ─────────────────────────────────────────────────────────────────────
export const card: CSSProperties = {
  backgroundColor: C.canvas,
  border: `1px solid ${C.border}`,
  borderRadius: R.lg,
  overflow: "hidden",
};

export const cardPadded: CSSProperties = {
  ...card,
  padding: "20px 24px",
};

// ─── Section heading ──────────────────────────────────────────────────────────
export const sectionTitle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: "0.05em",
  textTransform: "uppercase",
  color: C.ink3,
  margin: 0,
};

// ─── Form elements ────────────────────────────────────────────────────────────
export const fieldLabel: CSSProperties = {
  display: "block",
  fontSize: 12,
  fontWeight: 500,
  color: C.ink3,
  marginBottom: 4,
};

const inputBase: CSSProperties = {
  height: 40,
  padding: "0 12px",
  border: `1.5px solid ${C.border}`,
  borderRadius: R.md,
  fontSize: 14,
  color: C.ink,
  backgroundColor: C.canvas,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};

export const input: CSSProperties = inputBase;

export const select: CSSProperties = {
  ...inputBase,
  cursor: "pointer",
  appearance: "none" as CSSProperties["appearance"],
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239CA3AF' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
  backgroundRepeat: "no-repeat",
  backgroundPosition: "right 12px center",
  paddingRight: 36,
};

export const textarea: CSSProperties = {
  ...inputBase,
  height: "auto",
  padding: "10px 12px",
  resize: "vertical" as CSSProperties["resize"],
};

// ─── Buttons ──────────────────────────────────────────────────────────────────
const btnBase: CSSProperties = {
  height: 40,
  padding: "0 18px",
  borderRadius: R.md,
  fontSize: 14,
  fontWeight: 500,
  cursor: "pointer",
  border: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  whiteSpace: "nowrap" as CSSProperties["whiteSpace"],
  fontFamily: "inherit",
  transition: "opacity 0.15s",
};

export const btnPrimary: CSSProperties = {
  ...btnBase,
  backgroundColor: C.accent,
  color: "#FFFFFF",
};

export const btnSecondary: CSSProperties = {
  ...btnBase,
  backgroundColor: C.canvas,
  color: C.ink,
  border: `1.5px solid ${C.border}`,
};

export const btnDanger: CSSProperties = {
  ...btnBase,
  backgroundColor: C.roseBg,
  color: C.rose,
  border: `1.5px solid ${C.roseBorder}`,
};

export const btnSmall: CSSProperties = {
  height: 32,
  padding: "0 12px",
  borderRadius: R.sm,
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  border: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  fontFamily: "inherit",
};

// ─── Table ────────────────────────────────────────────────────────────────────
export const tableWrap: CSSProperties = {
  ...card,
  overflowX: "auto",
};

export const tbl: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
};

export const th: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: C.ink4,
  backgroundColor: C.subtle,
  padding: "10px 16px",
  textAlign: "left",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap" as CSSProperties["whiteSpace"],
};

export const thRight: CSSProperties = {
  ...th,
  textAlign: "right",
};

export const td: CSSProperties = {
  fontSize: 14,
  color: C.ink,
  padding: "12px 16px",
  borderBottom: `1px solid ${C.border}`,
};

export const tdRight: CSSProperties = {
  ...td,
  textAlign: "right",
};

export const tdMono: CSSProperties = {
  ...td,
  fontVariantNumeric: "tabular-nums",
};

export const tdMonoRight: CSSProperties = {
  ...tdMono,
  textAlign: "right",
};

// ─── Badges ───────────────────────────────────────────────────────────────────
const badgeBase: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  fontWeight: 500,
  padding: "2px 8px",
  borderRadius: 999,
  whiteSpace: "nowrap" as CSSProperties["whiteSpace"],
};

export const badgeGreen: CSSProperties = {
  ...badgeBase,
  color: C.green,
  backgroundColor: C.greenBg,
  border: `1px solid ${C.greenBorder}`,
};

export const badgeAmber: CSSProperties = {
  ...badgeBase,
  color: C.amber,
  backgroundColor: C.amberBg,
  border: `1px solid ${C.amberBorder}`,
};

export const badgeRose: CSSProperties = {
  ...badgeBase,
  color: C.rose,
  backgroundColor: C.roseBg,
  border: `1px solid ${C.roseBorder}`,
};

export const badgeGray: CSSProperties = {
  ...badgeBase,
  color: C.ink3,
  backgroundColor: C.subtle,
  border: `1px solid ${C.border}`,
};

// ─── Alert / Error box ────────────────────────────────────────────────────────
export const errBox: CSSProperties = {
  padding: "12px 16px",
  borderRadius: R.md,
  backgroundColor: C.roseBg,
  border: `1px solid ${C.roseBorder}`,
  color: C.rose,
  fontSize: 13,
};

// ─── Divider ──────────────────────────────────────────────────────────────────
export const divider: CSSProperties = {
  borderTop: `1px solid ${C.border}`,
  margin: "0",
};
