import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "react-router-dom";
import { confirm } from "@tauri-apps/plugin-dialog";

type Product = {
  barcode: string;
  product_code?: string | null;
  category?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  buy_price?: number | null;
  sell_price: number;
  stock?: number | null;
  magaza_stok?: number | null;
  depo_stok?: number | null;
  created_at?: string | null;
};

type ProductFamily = {
  key: string;
  name: string;
  category?: string | null;
  sell_price: number;
  items: Product[];
  total_stock: number;
  unique_colors: string[];
  unique_sizes: string[];
};

function getDisplayStock(p: Product): number {
  const hasLoc = p.magaza_stok != null || p.depo_stok != null;
  return hasLoc ? (p.magaza_stok ?? 0) + (p.depo_stok ?? 0) : (p.stock ?? 0);
}

function fmtMoney(v: number | null | undefined) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(v ?? 0);
}

function groupIntoFamilies(products: Product[]): ProductFamily[] {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    const key = (p.product_code ?? "").trim() || p.barcode;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  const families: ProductFamily[] = [];
  for (const [key, items] of map) {
    const first = items[0];
    families.push({
      key,
      name: first.name,
      category: first.category,
      sell_price: first.sell_price,
      items,
      total_stock: items.reduce((s, p) => s + getDisplayStock(p), 0),
      unique_colors: Array.from(new Set(items.map((p) => p.color ?? "").filter(Boolean))),
      unique_sizes:  Array.from(new Set(items.map((p) => p.size  ?? "").filter(Boolean))),
    });
  }
  return families;
}

const ACCENT = ["#fde68a", "#fbcfe8", "#bfdbfe", "#bbf7d0", "#fecaca", "#e9d5ff", "#fed7aa"];

export function Products() {
  const [loading, setLoading]   = useState(true);
  const [err, setErr]           = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ]               = useState("");
  const [showAll, setShowAll]   = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [activeCat, setActiveCat] = useState<string>("__all__");

  const load = async () => {
    try {
      setErr("");
      setLoading(true);
      setProducts(await invoke<Product[]>("list_products"));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const categoryList = useMemo(() => {
    const seen = new Set<string>();
    for (const p of products) {
      const c = (p.category ?? "").trim();
      if (c) seen.add(c);
    }
    return Array.from(seen).sort();
  }, [products]);

  const families = useMemo(() => {
    const t = q.trim().toLowerCase();
    const filtered = products.filter((p) => {
      if (!showAll && getDisplayStock(p) <= 0) return false;
      if (activeCat !== "__all__" && (p.category ?? "").trim() !== activeCat) return false;
      if (!t) return true;
      return [p.barcode, p.product_code ?? "", p.name, p.category ?? "", p.color ?? "", p.size ?? ""]
        .join(" ").toLowerCase().includes(t);
    });
    return groupIntoFamilies(filtered);
  }, [products, q, showAll, activeCat]);

  useEffect(() => {
    if (q.trim()) setExpanded(new Set(families.map((f) => f.key)));
  }, [q]);

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleDelete = async (barcode: string) => {
    const ok = await confirm(`${barcode} barkodlu ürünü silmek istiyor musun?`,
      { title: "Ürün Sil", kind: "warning" }
    );
    if (!ok) return;
    try {
      await invoke<number>("delete_product", { barcode: barcode.trim() });
      setProducts((prev) => prev.filter((p) => p.barcode !== barcode));
    } catch (e) {
      setErr(String(e));
    }
  };

  const totalSKU = families.reduce((s, f) => s + f.items.length, 0);

  return (
    <div style={P.page}>

      {/* ── Header ── */}
      <div style={P.header}>
        <div>
          <h2 style={P.title}>Ürünler</h2>
          <div style={P.subtitle}>
            {loading ? "Yükleniyor…" : `${families.length} aile · ${totalSKU} SKU`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link to="/products/new" style={P.primaryLink}>
            + Ürün Ekle
          </Link>
          <button type="button" onClick={load} disabled={loading} style={P.ghostBtn}>
            Yenile
          </button>
        </div>
      </div>

      {/* ── Search + filters ── */}
      <div style={P.filterBar}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ara: barkod, isim, renk, beden, kategori…"
          style={P.searchInput}
        />
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" onClick={() => setShowAll(false)}
            style={!showAll ? P.segOn : P.segOff}
          >Satışta</button>
          <button type="button" onClick={() => setShowAll(true)}
            style={showAll ? P.segOn : P.segOff}
          >Tümü</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <button type="button" onClick={() => setExpanded(new Set(families.map((f) => f.key)))} style={P.ghostBtn}>
            Hepsini Aç
          </button>
          <button type="button" onClick={() => setExpanded(new Set())} style={P.ghostBtn}>
            Kapat
          </button>
        </div>
      </div>

      {/* ── Category pills ── */}
      {categoryList.length > 0 && (
        <div style={P.catRow}>
          {[{ key: "__all__", label: "Tümü", count: null as number | null },
            ...categoryList.map((c) => ({
              key: c, label: c,
              count: products.filter((p) => (p.category ?? "").trim() === c && (showAll || getDisplayStock(p) > 0)).length,
            }))
          ].map(({ key, label, count }) => {
            const active = activeCat === key;
            return (
              <button key={key} type="button" onClick={() => setActiveCat(key)}
                style={active ? P.catOn : P.catOff}
              >
                {label}
                {count != null && (
                  <span style={{
                    fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "1px 6px",
                    background: active ? "rgba(255,255,255,0.2)" : "#f3f4f6",
                    color: active ? "#fff" : "#6b7280",
                  }}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {err && <div style={P.errBox}>❌ {err}</div>}

      {/* ── Family list ── */}
      {loading ? (
        <div style={{ padding: "48px 0", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Yükleniyor…</div>
      ) : families.length === 0 ? (
        <div style={{ padding: "48px 0", textAlign: "center", color: "#9ca3af", fontSize: 14 }}>Sonuç yok.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {families.map((family, fi) => {
            const isOpen = expanded.has(family.key);
            const isSolo = family.items.length === 1 && !(family.items[0].product_code ?? "").trim();
            const accent = ACCENT[fi % ACCENT.length];

            return (
              <div key={family.key} style={P.familyCard}>

                {/* ── Family header ── */}
                <div
                  onClick={() => toggleExpand(family.key)}
                  style={{ ...P.familyHeader, background: isOpen ? "#fafaf9" : "#fff", borderBottom: isOpen ? "1px solid #f3f4f6" : "none" }}
                >
                  {/* Accent bar */}
                  <div style={{ width: 3, height: 36, borderRadius: 4, background: accent, flexShrink: 0 }} />

                  {/* Product code badge */}
                  {!isSolo && (
                    <span style={P.codeTag}>{family.key}</span>
                  )}

                  {/* Name + category */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={P.familyName}>{family.name}</div>
                    {family.category && (
                      <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 1 }}>{family.category}</div>
                    )}
                  </div>

                  {/* Tags */}
                  <div style={P.tagRow}>
                    {!isSolo && family.unique_colors.length > 0 && (
                      <span style={P.tag}>{family.unique_colors.length} renk</span>
                    )}
                    {!isSolo && family.unique_sizes.length > 0 && (
                      <span style={P.tag}>{family.unique_sizes.length} beden</span>
                    )}
                    {!isSolo && (
                      <span style={P.tag}>{family.items.length} SKU</span>
                    )}
                    <span style={{
                      ...P.tag,
                      background: family.total_stock > 0 ? "#dcfce7" : "#fee2e2",
                      color:      family.total_stock > 0 ? "#15803d" : "#b91c1c",
                      fontWeight: 800,
                    }}>
                      {family.total_stock} stok
                    </span>
                    <span style={{ ...P.tag, fontWeight: 700, color: "#374151" }}>
                      {fmtMoney(family.sell_price)}
                    </span>
                  </div>

                  {/* Varyant ekle (family level) */}
                  {!isSolo && (
                    <Link
                      to={`/products/new?variantOf=${encodeURIComponent(family.key)}&from=${encodeURIComponent(family.items[0].barcode)}`}
                      onClick={(e) => e.stopPropagation()}
                      style={P.inlineBtn}
                    >
                      + Varyant
                    </Link>
                  )}

                  {/* Chevron */}
                  <span style={{ fontSize: 11, color: "#9ca3af", flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", display: "inline-block", transition: "transform 150ms" }}>▼</span>
                </div>

                {/* ── SKU rows ── */}
                {isOpen && (
                  <div>
                    {family.items.map((p, ii) => {
                      const magaza = p.magaza_stok ?? 0;
                      const depo   = p.depo_stok   ?? 0;
                      const total  = getDisplayStock(p);
                      return (
                        <div
                          key={p.barcode}
                          style={{
                            ...P.skuRow,
                            background: ii % 2 === 0 ? "#fff" : "#fafaf9",
                            borderTop: ii === 0 ? "none" : "1px solid #f3f4f6",
                          }}
                        >
                          {/* Left: barcode + color/size */}
                          <div style={P.skuLeft}>
                            <span style={P.barcodeMono}>{p.barcode}</span>
                            <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                              {p.color && <span style={{ fontSize: 12, color: "#6b7280" }}>{p.color}</span>}
                              {p.size  && <span style={P.sizePill}>{p.size}</span>}
                            </div>
                          </div>

                          {/* Center: prices + stock */}
                          <div style={P.skuCenter}>
                            <div style={P.skuStat}>
                              <span style={P.statLabel}>Alış</span>
                              <span style={{ fontWeight: 600, fontSize: 13, color: "#6b7280" }}>{fmtMoney(p.buy_price)}</span>
                            </div>
                            <div style={P.skuStat}>
                              <span style={P.statLabel}>Satış</span>
                              <span style={{ fontWeight: 800, fontSize: 13 }}>{fmtMoney(p.sell_price)}</span>
                            </div>
                            <div style={P.skuStat}>
                              <span style={P.statLabel}>Mağaza</span>
                              <span style={{ fontWeight: 700, fontSize: 13 }}>{magaza}</span>
                            </div>
                            <div style={P.skuStat}>
                              <span style={P.statLabel}>Depo</span>
                              <span style={{ fontWeight: 700, fontSize: 13 }}>{depo}</span>
                            </div>
                            <div style={P.skuStat}>
                              <span style={P.statLabel}>Toplam</span>
                              <span style={{
                                fontWeight: 900, fontSize: 14,
                                color: total <= 0 ? "#dc2626" : total <= 1 ? "#d97706" : "#111827",
                              }}>{total}</span>
                            </div>
                          </div>

                          {/* Right: actions */}
                          <div style={P.skuActions}>
                            <Link
                              to={`/products/${encodeURIComponent(p.barcode)}/edit`}
                              style={P.actionBtn}
                            >
                              Düzenle
                            </Link>
                            <Link
                              to={`/products/new?variantOf=${encodeURIComponent((p.product_code ?? p.barcode).trim() || p.barcode)}&from=${encodeURIComponent(p.barcode)}`}
                              style={P.actionBtn}
                            >
                              + Varyant
                            </Link>
                            <button
                              type="button"
                              onClick={() => handleDelete(p.barcode)}
                              style={P.deleteBtn}
                            >
                              Sil
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const P: Record<string, React.CSSProperties> = {
  page: {
    padding: 24,
    fontFamily: "system-ui, -apple-system, sans-serif",
    minHeight: "100%",
    boxSizing: "border-box",
  },

  // header
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
  primaryLink: {
    display: "inline-flex",
    alignItems: "center",
    padding: "8px 16px",
    borderRadius: 10,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    textDecoration: "none",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  ghostBtn: {
    padding: "8px 14px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 13,
    fontWeight: 700,
    color: "#374151",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  // filters
  filterBar: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
    marginBottom: 12,
  },
  searchInput: {
    flex: "1 1 220px",
    minWidth: 0,
    padding: "9px 13px",
    borderRadius: 11,
    border: "1.5px solid #e5e7eb",
    fontSize: 13,
    outline: "none",
    background: "#fff",
    color: "#111827",
  },
  segOn: {
    padding: "8px 14px",
    borderRadius: 10,
    border: "1.5px solid #111827",
    background: "#111827",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  segOff: {
    padding: "8px 14px",
    borderRadius: 10,
    border: "1.5px solid #e5e7eb",
    background: "#fff",
    color: "#374151",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  // category pills
  catRow: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    marginBottom: 16,
  },
  catOff: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    borderRadius: 999,
    border: "1.5px solid #e5e7eb",
    background: "#fff",
    color: "#374151",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  catOn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    borderRadius: 999,
    border: "1.5px solid #111827",
    background: "#111827",
    color: "#fff",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
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

  // family card
  familyCard: {
    background: "#fff",
    borderRadius: 14,
    border: "1px solid #EAE8E5",
    overflow: "hidden",
  },
  familyHeader: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "13px 16px",
    cursor: "pointer",
    userSelect: "none",
    flexWrap: "wrap",
  },
  codeTag: {
    fontSize: 11,
    fontWeight: 800,
    letterSpacing: 0.6,
    color: "#6b7280",
    background: "#f3f4f6",
    padding: "3px 8px",
    borderRadius: 6,
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  familyName: {
    fontWeight: 800,
    fontSize: 15,
    color: "#111827",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tagRow: {
    display: "flex",
    gap: 5,
    flexWrap: "wrap",
    justifyContent: "flex-end",
    flexShrink: 0,
  },
  tag: {
    display: "inline-flex",
    alignItems: "center",
    padding: "3px 8px",
    borderRadius: 6,
    fontSize: 11,
    fontWeight: 600,
    background: "#f3f4f6",
    color: "#374151",
    whiteSpace: "nowrap",
  },
  inlineBtn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 10px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#374151",
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },

  // SKU row — flex instead of table (no overflow)
  skuRow: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "11px 16px",
    flexWrap: "wrap",
  },
  skuLeft: {
    minWidth: 100,
    flexShrink: 0,
  },
  barcodeMono: {
    fontFamily: "monospace",
    fontSize: 12,
    color: "#6b7280",
  },
  sizePill: {
    background: "#f3f4f6",
    borderRadius: 5,
    padding: "1px 6px",
    fontSize: 11,
    fontWeight: 700,
    color: "#374151",
  },
  skuCenter: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    gap: 20,
    flexWrap: "wrap",
    alignItems: "center",
  },
  skuStat: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  skuActions: {
    display: "flex",
    gap: 6,
    flexShrink: 0,
    flexWrap: "wrap",
  },
  actionBtn: {
    display: "inline-flex",
    alignItems: "center",
    padding: "5px 10px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#374151",
    textDecoration: "none",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  deleteBtn: {
    padding: "5px 10px",
    borderRadius: 8,
    border: "1px solid #fecaca",
    background: "#fff",
    color: "#b91c1c",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
