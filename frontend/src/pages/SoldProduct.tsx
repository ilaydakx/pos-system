import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, R, page as dsPage, card, btnPrimary, btnSecondary, input, select as dsSelect, th as dsTh, td as dsTd, badgeRose, badgeAmber } from "../lib/ds";

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
  refunded_qty?: number;
  refund_kind?: "RETURN" | "EXCHANGE" | null;
};

export function SoldProducts() {
  const [days, setDays] = useState(15);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [groups, setGroups] = useState<SaleGroupRow[]>([]);
  const [openGroup, setOpenGroup] = useState<string>("");
  const [lines, setLines] = useState<Record<string, SaleLineRow[]>>({});

  const refundedOf = (l: SaleLineRow) => Number((l as any).refunded_qty ?? 0);
  const remainingOf = (l: SaleLineRow) => Math.max(0, Number(l.qty ?? 0) - refundedOf(l));

  const kindOf = (l: SaleLineRow): "EXCHANGE" | "RETURN" | null => {
    const k = (l as any).refund_kind;
    if (k === "EXCHANGE") return "EXCHANGE";
    if (k === "RETURN" || k === "REFUND") return "RETURN";
    return null;
  };

  const groupRefundKind = (ls: SaleLineRow[]) => {
    const hasExchange = ls.some((x) => refundedOf(x) > 0 && kindOf(x) === "EXCHANGE");
    const hasReturn = ls.some((x) => refundedOf(x) > 0 && kindOf(x) === "RETURN");
    if (hasExchange && !hasReturn) return "EXCHANGE";
    if (hasReturn && !hasExchange) return "RETURN";
    if (hasExchange && hasReturn) return "MIXED";
    // if kind is not available yet, still mark as REFUNDED if qty>0
    const hasAny = ls.some((x) => refundedOf(x) > 0);
    return hasAny ? "REFUNDED" : "NONE";
  };

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
    // We need line data for each group to mark returned/exchanged sales in the list.
    const targets = rows;
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
    <div style={dsPage}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>Satılan Ürünler</h2>
        <div style={{ marginLeft: "auto" }}>
          <button onClick={loadGroups} disabled={loading} style={btnSecondary}>
            Yenile
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          style={{ ...dsSelect, width: 120 }}
        >
          <option value={7}>Son 7 gün</option>
          <option value={15}>Son 15 gün</option>
          <option value={30}>Son 30 gün</option>
          <option value={90}>Son 90 gün</option>
        </select>

        <input
          placeholder="Ara: barkod / ürün adı"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ ...input, flex: 1, minWidth: 200 }}
        />

        <button onClick={() => loadGroups()} disabled={loading} style={btnPrimary}>
          Ara
        </button>
      </div>

      {err && (
        <div style={{ marginBottom: 12, padding: "10px 14px", borderRadius: R.md, backgroundColor: C.roseBg, color: C.rose, fontSize: 13 }}>
          {err}
        </div>
      )}

      {loading ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: C.ink4, fontSize: 14 }}>Yükleniyor...</div>
      ) : (
        <div style={{ ...card, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
            <thead>
              <tr>
                {["Tarih", "Fiş No", "Adet", "Toplam Tutar", "Detay"].map((h) => (
                  <th key={h} style={dsTh}>
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
                    <tr
                      style={(() => {
                        const ls = lines[g.sale_group_id] ?? [];
                        const k = groupRefundKind(ls);
                        if (k === "NONE") return undefined;
                        return { backgroundColor: C.roseBg };
                      })()}
                    >
                      <td style={dsTd}>{g.sold_at}</td>
                      <td style={{ ...dsTd, fontWeight: 600 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span>{g.sale_group_id}</span>
                          {(() => {
                            const ls = lines[g.sale_group_id] ?? [];
                            const k = groupRefundKind(ls);
                            if (k === "NONE") return null;
                            const label = k === "EXCHANGE" ? "Değişim" : "İade";
                            return <span style={badgeRose}>{label}</span>;
                          })()}
                        </div>
                      </td>
                      <td style={dsTd}>
                        {typeof g.qty === "number" && g.qty > 0
                          ? g.qty
                          : (lines[g.sale_group_id]?.reduce((a, x) => a + (x.qty ?? 0), 0) ?? 0)}
                      </td>
                      <td style={dsTd}>
                        {fmtMoney(
                          typeof g.total === "number" && g.total !== 0
                            ? g.total
                            : (lines[g.sale_group_id]?.reduce((a, x) => a + (x.total ?? 0), 0) ?? 0)
                        )}
                      </td>
                      <td style={dsTd}>
                        <button
                          onClick={async () => {
                            const next = isOpen ? "" : g.sale_group_id;
                            setOpenGroup(next);
                            if (!isOpen) await loadLines(g.sale_group_id);
                          }}
                          style={{ ...btnSecondary, height: 32, padding: "0 12px", fontSize: 13 }}
                        >
                          {isOpen ? "Kapat" : "Aç"}
                        </button>
                      </td>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={5} style={{ padding: "12px 16px", backgroundColor: C.subtle }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: C.ink2, marginBottom: 10 }}>Fiş Detayı</div>

                          <div style={{ overflow: "auto", borderRadius: R.md, border: `1px solid ${C.border}`, backgroundColor: C.canvas }}>
                            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                              <thead>
                                <tr>
                                  {["Barkod", "Ürün", "Adet", "Durum", "Satıldığı Fiyat", "Birim ₺", "Satış Yeri", "Ödeme"].map((h) => (
                                    <th key={h} style={dsTh}>
                                      {h}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {(lines[g.sale_group_id] ?? []).map((l) => (
                                  <tr key={l.id}>
                                    <td style={dsTd}>{l.product_barcode}</td>
                                    <td style={{ ...dsTd, fontWeight: 500 }}>
                                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                                        <span>{l.name || "-"}</span>
                                        {refundedOf(l) > 0 && (
                                          <span style={{ fontSize: 12, color: C.ink3 }}>
                                            Kalan: {remainingOf(l)} / {l.qty}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td style={dsTd}>{l.qty}</td>
                                    <td style={dsTd}>
                                      {(() => {
                                        const r = refundedOf(l);
                                        if (r <= 0) return <span style={{ color: C.ink4 }}>—</span>;
                                        const fully = remainingOf(l) === 0;
                                        const k = kindOf(l);
                                        const label = k === "EXCHANGE" ? "Değişim" : "İade";
                                        const txt = fully ? label : `${label}: ${r}/${l.qty}`;
                                        return <span style={fully ? badgeRose : badgeAmber}>{txt}</span>;
                                      })()}
                                    </td>
                                    <td style={dsTd}>
                                      {(() => {
                                        const list = (l.list_price ?? 0) || 0;
                                        const disc = (l.discount_amount ?? 0) || 0;
                                        const discounted = disc > 0 || (list > 0 && list > (l.unit_price ?? 0));
                                        return discounted ? fmtMoney(l.unit_price) : <span style={{ color: C.ink4 }}>—</span>;
                                      })()}
                                    </td>
                                    <td style={dsTd}>
                                      {fmtMoney((l.list_price ?? 0) > 0 ? (l.list_price as number) : l.unit_price)}
                                    </td>
                                    <td style={dsTd}>{l.sold_from}</td>
                                    <td style={dsTd}>
                                      {(() => {
                                        const pm = (l as any).payment_method ?? (g as any).payment_method;
                                        if (!pm) return <span style={{ color: C.ink4 }}>—</span>;
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
                                    <td colSpan={8} style={{ ...dsTd, color: C.ink4 }}>
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
                  <td colSpan={5} style={{ ...dsTd, color: C.ink4 }}>
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


function fmtMoney(v: number | null | undefined) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(v ?? 0);
}