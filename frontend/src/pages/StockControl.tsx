import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWindowWidth } from "../hooks/useWindowWidth";

type Product = {
  barcode: string;
  product_code?: string | null;
  category?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  sell_price?: number | null;
  stock?: number | null;
  magaza_baslangic?: number | null;
  depo_baslangic?: number | null;
  toplam_stok?: number | null;
  magaza_stok?: number | null;
  depo_stok?: number | null;
  toplam_kalan?: number | null;
};

type RowStatus = {
  mismatch_kalan: boolean;
  mismatch_baslangic: boolean;
  negative: boolean;
  out_of_stock: boolean;
  only_store: boolean;
  only_warehouse: boolean;
};

function asInt(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function asNum(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function fmtMoney(v: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(v ?? 0);
}

export function StockControl() {
  const width = useWindowWidth();

  const showBarcode    = width >= 860;
  const showCategory   = width >= 1020;
  const showPrice      = width >= 780;
  const showBaslangic  = width >= 1160;

  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState<string>("");
  const [rows, setRows]       = useState<Product[]>([]);
  const [q, setQ]             = useState("");

  const [fMismatch,      setFMismatch]      = useState(false);
  const [fOut,           setFOut]           = useState(false);
  const [fOnlyStore,     setFOnlyStore]     = useState(false);
  const [fOnlyWarehouse, setFOnlyWarehouse] = useState(false);

  const load = async () => {
    try {
      setErr("");
      setLoading(true);
      setRows(await invoke<Product[]>("list_products"));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const computed = useMemo(() => {
    const t = q.trim().toLowerCase();

    const mapped = rows.map((p) => {
      const legacyStock = p.magaza_stok == null && p.depo_stok == null && p.stock != null;
      const legacy      = asInt(p.stock);

      const magaza_stok      = legacyStock ? legacy : asInt(p.magaza_stok);
      const depo_stok        = legacyStock ? 0      : asInt(p.depo_stok);
      const magaza_baslangic = legacyStock ? legacy : asInt(p.magaza_baslangic);
      const depo_baslangic   = legacyStock ? 0      : asInt(p.depo_baslangic);

      const toplam_kalan_calc  = magaza_stok + depo_stok;
      const toplam_stok_calc   = magaza_baslangic + depo_baslangic;
      const toplam_kalan_db    = asInt(p.toplam_kalan);
      const toplam_stok_db     = asInt(p.toplam_stok);

      const mismatch_kalan     = p.toplam_kalan != null && toplam_kalan_db !== toplam_kalan_calc;
      const mismatch_baslangic = p.toplam_stok  != null && toplam_stok_db  !== toplam_stok_calc;
      const negative           = magaza_stok < 0 || depo_stok < 0 || (p.toplam_kalan != null && toplam_kalan_db < 0);
      const out_of_stock       = toplam_kalan_calc === 0;
      const only_store         = magaza_stok > 0 && depo_stok === 0;
      const only_warehouse     = depo_stok > 0 && magaza_stok === 0;

      const status: RowStatus = { mismatch_kalan, mismatch_baslangic, negative, out_of_stock, only_store, only_warehouse };

      const hay = [p.barcode, p.product_code ?? "", p.category ?? "", p.name, p.color ?? "", p.size ?? ""]
        .join(" ").toLowerCase();

      const pass =
        (!t || hay.includes(t)) &&
        (!fMismatch || mismatch_kalan || mismatch_baslangic || negative) &&
        (!fOut || out_of_stock) &&
        (!fOnlyStore || only_store) &&
        (!fOnlyWarehouse || only_warehouse);

      return { p, status, magaza_stok, depo_stok, magaza_baslangic, depo_baslangic, toplam_kalan_calc, legacyStock, pass };
    });

    const visible = mapped.filter((x) => x.pass);
    const counts = {
      total:         rows.length,
      visible:       visible.length,
      mismatch:      mapped.filter((x) => x.status.mismatch_kalan || x.status.mismatch_baslangic || x.status.negative).length,
      out:           mapped.filter((x) => x.status.out_of_stock).length,
      onlyStore:     mapped.filter((x) => x.status.only_store).length,
      onlyWarehouse: mapped.filter((x) => x.status.only_warehouse).length,
    };

    return { visible, counts };
  }, [rows, q, fMismatch, fOut, fOnlyStore, fOnlyWarehouse]);

  const rowBg = (s: RowStatus): string => {
    if (s.negative) return "#fef2f2";
    if (s.mismatch_kalan || s.mismatch_baslangic) return "#fffbeb";
    return "#fff";
  };

  const filters = [
    { label: "Uyumsuz",       count: computed.counts.mismatch,      val: fMismatch,      set: setFMismatch },
    { label: "Stok 0",        count: computed.counts.out,           val: fOut,           set: setFOut },
    { label: "Sadece Mağaza", count: computed.counts.onlyStore,     val: fOnlyStore,     set: setFOnlyStore },
    { label: "Sadece Depo",   count: computed.counts.onlyWarehouse, val: fOnlyWarehouse, set: setFOnlyWarehouse },
  ];

  return (
    <div style={P.page}>

      {/* ── Header ── */}
      <div style={P.header}>
        <div>
          <h2 style={P.title}>Stok Kontrol</h2>
          <div style={P.subtitle}>
            {loading ? "Yükleniyor…" : `${computed.counts.visible} / ${computed.counts.total} ürün`}
          </div>
        </div>
        <button type="button" onClick={load} disabled={loading} style={P.refreshBtn}>
          {loading ? "…" : "Yenile"}
        </button>
      </div>

      {/* ── Filters ── */}
      <div style={P.filterBar}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ara: barkod, isim, renk, beden…"
          style={P.searchInput}
        />
        <div style={P.chips}>
          {filters.map((f) => (
            <button key={f.label} type="button" onClick={() => f.set(!f.val)}
              style={f.val ? P.chipOn : P.chipOff}
            >
              {f.label}
              <span style={{
                ...P.chipBadge,
                background: f.val ? "rgba(255,255,255,0.18)" : "#f3f4f6",
                color: f.val ? "#fff" : "#6b7280",
              }}>
                {f.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {err && <div style={P.errBox}>❌ {err}</div>}

      {/* ── Table ── */}
      {loading ? (
        <div style={{ padding: "48px 0", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
          Yükleniyor…
        </div>
      ) : (
        <div style={P.tableWrap}>
          <table style={P.table}>
            <colgroup>
              <col style={{ width: 68 }} />
              <col style={{ width: "auto" }} />
              {showBarcode   && <col style={{ width: 120 }} />}
              {showCategory  && <col style={{ width: 90 }} />}
              {showPrice     && <col style={{ width: 80 }} />}
              <col style={{ width: 120 }} />
              <col style={{ width: 60 }} />
              {showBaslangic && <col style={{ width: 120 }} />}
            </colgroup>
            <thead>
              <tr>
                <th style={P.th}>Durum</th>
                <th style={P.th}>Ürün</th>
                {showBarcode   && <th style={P.th}>Barkod</th>}
                {showCategory  && <th style={P.th}>Kategori</th>}
                {showPrice     && <th style={P.th}>Fiyat</th>}
                <th style={{ ...P.th, textAlign: "center" }}>Mevcut Stok</th>
                <th style={{ ...P.th, textAlign: "right" }}>Kalan</th>
                {showBaslangic && <th style={{ ...P.th, textAlign: "center" }}>Başlangıç</th>}
              </tr>
            </thead>
            <tbody>
              {computed.visible.map(({ p, status, magaza_stok, depo_stok, magaza_baslangic, depo_baslangic, toplam_kalan_calc, legacyStock }) => (
                <tr key={p.barcode} style={{ background: rowBg(status) }}>

                  {/* Status */}
                  <td style={P.td}>
                    <StatusBadge s={status} />
                    {legacyStock && (
                      <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 2, textTransform: "uppercase", letterSpacing: 0.4 }}>eski</div>
                    )}
                  </td>

                  {/* Product */}
                  <td style={{ ...P.td, overflow: "hidden" }}>
                    <div style={P.itemName}>{p.name}</div>
                    {(p.color || p.size) && (
                      <div style={P.itemMeta}>
                        {p.color && <span>{p.color}</span>}
                        {p.size  && <span style={P.sizePill}>{p.size}</span>}
                      </div>
                    )}
                  </td>

                  {/* Barcode */}
                  {showBarcode && (
                    <td style={P.td}>
                      <div style={P.mono}>{p.barcode}</div>
                      {p.product_code && (
                        <div style={{ ...P.mono, color: "#9ca3af", marginTop: 1 }}>{p.product_code}</div>
                      )}
                    </td>
                  )}

                  {/* Category */}
                  {showCategory && (
                    <td style={{ ...P.td, color: "#6b7280", fontSize: 13 }}>{p.category ?? "—"}</td>
                  )}

                  {/* Price */}
                  {showPrice && (
                    <td style={{ ...P.td, fontWeight: 700, fontSize: 13 }}>{fmtMoney(asNum(p.sell_price))}</td>
                  )}

                  {/* M / D */}
                  <td style={{ ...P.td, textAlign: "center" }}>
                    <StockPair a={magaza_stok} b={depo_stok} />
                  </td>

                  {/* Kalan */}
                  <td style={{ ...P.td, textAlign: "right" }}>
                    <span style={{
                      fontSize: 17,
                      fontWeight: 900,
                      color: toplam_kalan_calc === 0 ? "#dc2626" : toplam_kalan_calc <= 2 ? "#d97706" : "#111827",
                    }}>
                      {toplam_kalan_calc}
                    </span>
                  </td>

                  {/* Başlangıç */}
                  {showBaslangic && (
                    <td style={{ ...P.td, textAlign: "center" }}>
                      <StockPair a={magaza_baslangic} b={depo_baslangic} />
                    </td>
                  )}
                </tr>
              ))}

              {computed.visible.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: "36px 20px", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
                    Sonuç yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ s }: { s: RowStatus }) {
  if (s.negative)
    return <Pill bg="#fee2e2" color="#b91c1c">HATA</Pill>;
  if (s.mismatch_kalan || s.mismatch_baslangic)
    return <Pill bg="#fef3c7" color="#92400e">UYUMSUZ</Pill>;
  if (s.out_of_stock)
    return <Pill bg="#f3f4f6" color="#6b7280">SIFIR</Pill>;
  return <Pill bg="#dcfce7" color="#15803d">OK</Pill>;
}

function Pill({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 999,
      fontSize: 10,
      fontWeight: 800,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      background: bg,
      color,
      whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function StockPair({ a, b }: { a: number; b: number }) {
  return (
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 2 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, width: 42 }}>Mağaza</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{a}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, width: 42 }}>Depo</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{b}</span>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const P: Record<string, React.CSSProperties> = {
  page: {
    padding: 24,
    fontFamily: "system-ui, -apple-system, sans-serif",
    boxSizing: "border-box",
    minHeight: "100%",
  },

  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 20,
  },
  title: {
    margin: 0,
    fontSize: 22,
    fontWeight: 900,
    color: "#111827",
    lineHeight: 1.2,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: "#9ca3af",
  },
  refreshBtn: {
    padding: "8px 16px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 13,
    fontWeight: 700,
    color: "#374151",
    cursor: "pointer",
    flexShrink: 0,
  },

  filterBar: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 16,
  },
  searchInput: {
    flex: "1 1 200px",
    minWidth: 0,
    padding: "9px 13px",
    borderRadius: 11,
    border: "1.5px solid #e5e7eb",
    fontSize: 13,
    fontWeight: 500,
    outline: "none",
    background: "#fff",
    color: "#111827",
  },
  chips: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
  },
  chipOff: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    borderRadius: 999,
    border: "1.5px solid #e5e7eb",
    background: "#fff",
    fontSize: 12,
    fontWeight: 700,
    color: "#374151",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  chipOn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 12px",
    borderRadius: 999,
    border: "1.5px solid #111827",
    background: "#111827",
    fontSize: 12,
    fontWeight: 700,
    color: "#fff",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  chipBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 18,
    height: 18,
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    padding: "0 5px",
  },

  errBox: {
    padding: "10px 14px",
    borderRadius: 12,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 14,
  },

  tableWrap: {
    background: "#fff",
    borderRadius: 14,
    border: "1px solid #EAE8E5",
    overflow: "hidden",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    fontSize: 13,
  },
  th: {
    textAlign: "left",
    padding: "10px 16px",
    fontSize: 11,
    fontWeight: 600,
    color: "#9CA3AF",
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    background: "#FAF9F8",
    borderBottom: "1px solid #EAE8E5",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px 16px",
    verticalAlign: "middle",
    borderBottom: "1px solid #EAE8E5",
  },

  itemName: {
    fontWeight: 700,
    fontSize: 14,
    color: "#111827",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  itemMeta: {
    display: "flex",
    gap: 5,
    marginTop: 3,
    alignItems: "center",
    flexWrap: "wrap",
  },
  sizePill: {
    background: "#f3f4f6",
    borderRadius: 5,
    padding: "1px 6px",
    fontSize: 11,
    fontWeight: 700,
    color: "#374151",
  },
  mono: {
    fontFamily: "monospace",
    fontSize: 11,
    color: "#6b7280",
  },
};
