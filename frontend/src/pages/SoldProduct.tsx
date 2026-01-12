import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type SaleGroupRow = {
  sale_group_id: string;
  sold_at: string;
  qty: number;
  total: number;
  payment_method?: string;
};

type SaleLineRow = {
  id: number;
  sale_group_id: string;
  product_barcode: string;
  name?: string;
  qty: number;
  list_price?: number;
  discount_amount?: number;
  unit_price: number;
  total: number;
  sold_at: string;
  sold_from: string;
  payment_method?: string;
};

export function SoldProducts() {
  const [days, setDays] = useState(15);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [groups, setGroups] = useState<SaleGroupRow[]>([]);
  const [openGroup, setOpenGroup] = useState<string>("");
  const [lines, setLines] = useState<Record<string, SaleLineRow[]>>({});

  const fetchLines = async (sale_group_id: string) => {
    try {
      return await invoke<SaleLineRow[]>("list_sales_by_group", { saleGroupId: sale_group_id });
    } catch (e1) {
      try {
        return await invoke<SaleLineRow[]>("list_sales_by_group", { sale_group_id });
      } catch (e2) {
        // surface the first error (usually the useful one)
        throw e1;
      }
    }
  };

  // Helper: compute summary for group from lines
  const computeGroupFromLines = (_sale_group_id: string, ls: SaleLineRow[]) => {
    const qty = ls.reduce((a, x) => a + (x.qty ?? 0), 0);
    const total = ls.reduce((a, x) => a + (x.total ?? 0), 0);
    const pm = ls.find((x) => (x as any).payment_method)?.payment_method;
    const sold_at = ls.reduce((max, x) => {
      const v = x.sold_at || "";
      return v > max ? v : max;
    }, "");

    return { qty, total, payment_method: pm, sold_at };
  };

  // Preload summaries for groups missing qty/total
  const preloadSummaries = async (rows: SaleGroupRow[]) => {
    const targets = rows.filter((g) => (g.qty ?? 0) === 0 && (g.total ?? 0) === 0);
    if (targets.length === 0) return;

    const chunkSize = 6;
    for (let i = 0; i < targets.length; i += chunkSize) {
      const chunk = targets.slice(i, i + chunkSize);
      const results = await Promise.all(
        chunk.map(async (g) => {
          try {
            const ls = await fetchLines(g.sale_group_id);
            return { id: g.sale_group_id, ls };
          } catch (e) {
            setErr(String(e));
            return { id: g.sale_group_id, ls: [] as SaleLineRow[] };
          }
        })
      );

      setLines((prev) => {
        const next = { ...prev };
        for (const r of results) {
          if (!next[r.id]) next[r.id] = r.ls;
        }
        return next;
      });

      setGroups((prev) =>
        prev.map((g) => {
          const found = results.find((r) => r.id === g.sale_group_id);
          if (!found) return g;
          const s = computeGroupFromLines(g.sale_group_id, found.ls);
          return {
            ...g,
            qty: s.qty,
            total: s.total,
            sold_at: s.sold_at || g.sold_at,
            payment_method: s.payment_method || g.payment_method,
          };
        })
      );
    }
  };

  const loadGroups = async () => {
    try {
      setErr("");
      setLoading(true);
      const res = await invoke<SaleGroupRow[]>("list_sale_groups", { days, q: q.trim() || null });
      setGroups(res);
      await preloadSummaries(res);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadLines = async (sale_group_id: string) => {
    try {
      if (lines[sale_group_id]) return;
      const res = await fetchLines(sale_group_id);
      setLines((prev) => ({ ...prev, [sale_group_id]: res }));
    } catch (e) {
      setErr(String(e));
    }
  };

  useEffect(() => {
    loadGroups();
  }, []);

  useEffect(() => {
    loadGroups();
  }, [days]);

  const filteredGroups = useMemo(() => groups, [groups]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Satılan Ürünler</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={loadGroups} disabled={loading}>
            Yenile
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Son
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={7}>7 gün</option>
            <option value={15}>15 gün</option>
            <option value={30}>30 gün</option>
            <option value={90}>90 gün</option>
          </select>
        </label>

        <input
          placeholder="Ara: barkod / ürün adı"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 240, padding: 8 }}
        />

        <button onClick={() => loadGroups()} disabled={loading}>
          Ara
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>
          ❌ {err}
        </div>
      )}

      {loading ? (
        <div style={{ marginTop: 16 }}>Yükleniyor...</div>
      ) : (
        <div style={{ marginTop: 16, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                {["Tarih", "Fiş No", "Adet", "Toplam Tutar", "Detay"].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredGroups.map((g) => {
                const isOpen = openGroup === g.sale_group_id;
                return (
                  <React.Fragment key={g.sale_group_id}>
                    <tr>
                      <td style={td}>{g.sold_at}</td>
                      <td style={tdStrong}>{g.sale_group_id}</td>
                      <td style={td}>
                        {typeof g.qty === "number" && g.qty > 0
                          ? g.qty
                          : (lines[g.sale_group_id]?.reduce((a, x) => a + (x.qty ?? 0), 0) ?? 0)}
                      </td>
                      <td style={td}>
                        {fmtMoney(
                          typeof g.total === "number" && g.total !== 0
                            ? g.total
                            : (lines[g.sale_group_id]?.reduce((a, x) => a + (x.total ?? 0), 0) ?? 0)
                        )}
                      </td>
                      <td style={td}>
                        <button
                          onClick={async () => {
                            const next = isOpen ? "" : g.sale_group_id;
                            setOpenGroup(next);
                            if (!isOpen) await loadLines(g.sale_group_id);
                          }}
                        >
                          {isOpen ? "Kapat" : "Aç"}
                        </button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={5} style={{ padding: 12, background: "#fafafa" }}>
                          <div style={{ fontWeight: 600, marginBottom: 8 }}>Fiş Detayı</div>

                          <div style={{ overflow: "auto" }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                              <thead>
                                <tr>
                                  {["Barkod", "Ürün", "Adet", "Satıldığı Fiyat", "Birim ₺", "Satış Yeri", "Ödeme"].map((h) => (
                                    <th key={h} style={thSmall}>
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(lines[g.sale_group_id] ?? []).map((l) => (
                                  <tr key={l.id}>
                                    <td style={tdSmall}>{l.product_barcode}</td>
                                    <td style={tdSmallStrong}>{l.name || "-"}</td>
                                    <td style={tdSmall}>{l.qty}</td>
                                    <td style={tdSmall}>
                                      {(() => {
                                        const list = (l.list_price ?? 0) || 0;
                                        const disc = (l.discount_amount ?? 0) || 0;
                                        const discounted = disc > 0 || (list > 0 && list > (l.unit_price ?? 0));
                                        return discounted ? fmtMoney(l.unit_price) : "-";
                                      })()}
                                    </td>
                                    <td style={tdSmall}>
                                      {fmtMoney((l.list_price ?? 0) > 0 ? (l.list_price as number) : l.unit_price)}
                                    </td>
                                    <td style={tdSmall}>{l.sold_from}</td>
                                    <td style={tdSmall}>
                                      {(() => {
                                        const pm = (l as any).payment_method ?? (g as any).payment_method;
                                        if (!pm) return "-";
                                        const v = String(pm).toUpperCase();
                                        if (v === "CASH") return "Nakit";
                                        if (v === "CARD") return "Kart";
                                        return String(pm);
                                      })()}
                                    </td>
                                  </tr>
                                ))}
                                {(lines[g.sale_group_id]?.length ?? 0) === 0 && (
                                  <tr>
                                    <td colSpan={7} style={{ padding: 10, opacity: 0.7 }}>
                                      Detay yok.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {filteredGroups.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, opacity: 0.7 }}>
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

const th: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #ddd",
  padding: "10px 8px",
  position: "sticky",
  top: 0,
  background: "white",
};

const td: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f0f0f0",
  whiteSpace: "nowrap",
};

const tdStrong: React.CSSProperties = { ...td, fontWeight: 700 };

const thSmall: React.CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #e5e5e5",
  padding: "8px 6px",
  background: "#fafafa",
};

const tdSmall: React.CSSProperties = {
  padding: "8px 6px",
  borderBottom: "1px solid #eee",
  whiteSpace: "nowrap",
};

const tdSmallStrong: React.CSSProperties = { ...tdSmall, fontWeight: 600 };

function fmtMoney(v: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(v ?? 0);
}