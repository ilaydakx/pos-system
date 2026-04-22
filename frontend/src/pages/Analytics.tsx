import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type VelocityRow = {
  barcode: string;
  name: string;
  color?: string | null;
  size?: string | null;
  category?: string | null;
  total_sold: number;
  daily_avg: number;
  current_stock: number;
  days_to_empty?: number | null;
};

type DeadStockRow = {
  barcode: string;
  name: string;
  color?: string | null;
  size?: string | null;
  category?: string | null;
  stock: number;
  days_since_last_sale: number;
  last_sold_at?: string | null;
};

type CategoryMarginRow = {
  category: string;
  total_qty: number;
  revenue: number;
  cost: number;
  gross_profit: number;
  margin_pct: number;
  profit_share_pct: number;
};

type BasketPairRow = {
  barcode_a: string;
  barcode_b: string;
  name_a: string;
  name_b: string;
  color_a?: string | null;
  color_b?: string | null;
  together_count: number;
};

type Tab = "velocity" | "dead" | "margin" | "basket" | "lowstock";

type LowStockRow = {
  barcode: string;
  name: string;
  color?: string | null;
  size?: string | null;
  category?: string | null;
  magaza_stok: number;
  depo_stok: number;
  total_stock: number;
};

function fmtMoney(v: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(v ?? 0);
}

function fmtPct(v: number) {
  return `%${v.toFixed(1)}`;
}

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #EAE8E5",
  borderRadius: 14,
  padding: 16,
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 16px",
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#9CA3AF",
  backgroundColor: "#FAF9F8",
  borderBottom: "1px solid #EAE8E5",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #EAE8E5",
  fontSize: 14,
  color: "#111827",
  whiteSpace: "nowrap",
};

const tdBold: React.CSSProperties = { ...td, fontWeight: 700 };

export function Analytics() {
  const [tab, setTab] = useState<Tab>("velocity");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // velocity
  const [velocityDays, setVelocityDays] = useState<30 | 60 | 90>(30);
  const [velocity, setVelocity] = useState<VelocityRow[]>([]);
  const [zeroSales, setZeroSales] = useState<DeadStockRow[]>([]); // dönemde hiç satmayan stoklu ürünler

  // dead stock
  const [dead, setDead] = useState<DeadStockRow[]>([]);

  // margin
  const [marginDays, setMarginDays] = useState<30 | 90 | 180>(90);
  const [margin, setMargin] = useState<CategoryMarginRow[]>([]);

  // basket
  const [basket, setBasket] = useState<BasketPairRow[]>([]);

  // low stock
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [lowStockThreshold, setLowStockThreshold] = useState<2 | 5 | 10>(2);

  const load = async (t: Tab) => {
    setLoading(true);
    setErr("");
    try {
      if (t === "velocity") {
        const [rows, zero] = await Promise.all([
          invoke<VelocityRow[]>("get_velocity_report", { days: velocityDays }),
          invoke<DeadStockRow[]>("get_dead_stock", { minDays: velocityDays }),
        ]);
        setVelocity(rows ?? []);
        // Hiç satış olmayan = dead stock listesinden dönem uzunluğuna uyanlar (zaten minDays=velocityDays)
        setZeroSales(zero ?? []);
      } else if (t === "dead") {
        const rows = await invoke<DeadStockRow[]>("get_dead_stock", { minDays: 21 });
        setDead(rows ?? []);
      } else if (t === "margin") {
        const rows = await invoke<CategoryMarginRow[]>("get_category_margin", { days: marginDays });
        setMargin(rows ?? []);
      } else if (t === "basket") {
        const rows = await invoke<BasketPairRow[]>("get_basket_pairs", { limit: 30 });
        setBasket(rows ?? []);
      } else if (t === "lowstock") {
        const rows = await invoke<LowStockRow[]>("get_low_stock", { maxStock: lowStockThreshold });
        setLowStock(rows ?? []);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, velocityDays, marginDays, lowStockThreshold]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "velocity", label: "Hız Analizi" },
    { key: "dead", label: "Ölü Stok" },
    { key: "margin", label: "Kategori Kâr Marjı" },
    { key: "basket", label: "Sepet Analizi" },
    { key: "lowstock", label: `⚠️ Düşük Stok${lowStock.length > 0 ? ` (${lowStock.length})` : ""}` },
  ];

  return (
    <div style={{ padding: 18, fontFamily: "system-ui", background: "#fbf6f3", minHeight: "100%" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 900, color: "#111827" }}>Analiz</h1>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>
          Mevcut veriler üzerinden iş kararı almak için
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: "9px 16px",
              borderRadius: 12,
              border: "1px solid rgba(17,24,39,0.15)",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13,
              background: tab === t.key ? "#111827" : "#fff",
              color: tab === t.key ? "#fff" : "#111827",
            }}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => load(tab)}
          disabled={loading}
          style={{
            marginLeft: "auto",
            padding: "9px 14px",
            borderRadius: 12,
            border: "1px solid #e5e7eb",
            background: "#fff",
            cursor: "pointer",
            fontWeight: 700,
            fontSize: 13,
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Yükleniyor…" : "Yenile"}
        </button>
      </div>

      {err && (
        <div style={{ marginBottom: 12, padding: 12, borderRadius: 12, background: "#fee2e2", color: "#991b1b", fontWeight: 700 }}>
          {err}
        </div>
      )}

      {/* ── HIZ ANALİZİ ── */}
      {tab === "velocity" && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Hız Analizi</div>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                Seçili dönemdeki satışlara göre günlük ortalama ve tahmini tükenme süresi
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {([30, 60, 90] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setVelocityDays(d)}
                  style={{
                    padding: "6px 12px", borderRadius: 8, border: "1px solid #e5e7eb",
                    background: velocityDays === d ? "#111827" : "#fff",
                    color: velocityDays === d ? "#fff" : "#111827",
                    cursor: "pointer", fontWeight: 700, fontSize: 12,
                  }}
                >
                  Son {d}g
                </button>
              ))}
            </div>
          </div>

          {velocity.length === 0 && !loading && (
            <div style={{ opacity: 0.6, padding: 8 }}>Bu dönemde satış kaydı yok.</div>
          )}

          {velocity.length > 0 && (
            <>
              {/* Hızlı satanlar */}
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#059669" }}>
                En Hızlı Satanlar (top 10)
              </div>
              <div style={{ overflowX: "auto", marginBottom: 20 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Ürün", "Renk", "Beden", "Kategori", "Dönem Satış", "Günlük Ort.", "Mevcut Stok", "Tahmini Tükenme"].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {velocity.slice(0, 10).map((r) => (
                      <tr key={r.barcode}>
                        <td style={tdBold}>{r.name}</td>
                        <td style={td}>{r.color ?? "—"}</td>
                        <td style={td}>{r.size ?? "—"}</td>
                        <td style={td}>{r.category ?? "—"}</td>
                        <td style={td}>{r.total_sold} adet</td>
                        <td style={td}>{r.daily_avg.toFixed(2)}/gün</td>
                        <td style={{ ...td, color: r.current_stock <= 3 ? "#b91c1c" : undefined, fontWeight: r.current_stock <= 3 ? 700 : undefined }}>
                          {r.current_stock}
                        </td>
                        <td style={td}>
                          {r.days_to_empty != null
                            ? r.days_to_empty === 0
                              ? <span style={{ color: "#b91c1c", fontWeight: 700 }}>Bugün biter</span>
                              : `~${r.days_to_empty} gün`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Yavaş satanlar */}
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#d97706" }}>
                En Yavaş Satanlar — dönemde satışı var ama az (alt 10)
              </div>
              <div style={{ overflowX: "auto", marginBottom: 20 }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Ürün", "Renk", "Beden", "Kategori", "Dönem Satış", "Günlük Ort.", "Mevcut Stok", "Tahmini Tükenme"].map((h) => (
                        <th key={h} style={th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...velocity].reverse().slice(0, 10).map((r) => (
                      <tr key={r.barcode}>
                        <td style={tdBold}>{r.name}</td>
                        <td style={td}>{r.color ?? "—"}</td>
                        <td style={td}>{r.size ?? "—"}</td>
                        <td style={td}>{r.category ?? "—"}</td>
                        <td style={td}>{r.total_sold} adet</td>
                        <td style={td}>{r.daily_avg.toFixed(2)}/gün</td>
                        <td style={td}>{r.current_stock}</td>
                        <td style={td}>
                          {r.days_to_empty != null ? `~${r.days_to_empty} gün` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Dönemde hiç satılmayanlar */}
              {zeroSales.length > 0 && (
                <>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "#b91c1c" }}>
                    Dönemde Hiç Satılmayanlar — stoğu var, son {velocityDays} günde sıfır satış ({zeroSales.length} ürün)
                  </div>
                  <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          {["Ürün", "Renk", "Beden", "Kategori", "Stok", "Son Satış", "Satışsız Gün"].map((h) => (
                            <th key={h} style={th}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {zeroSales.slice(0, 20).map((r) => (
                          <tr key={r.barcode}>
                            <td style={tdBold}>{r.name}</td>
                            <td style={td}>{r.color ?? "—"}</td>
                            <td style={td}>{r.size ?? "—"}</td>
                            <td style={td}>{r.category ?? "—"}</td>
                            <td style={td}>{r.stock}</td>
                            <td style={{ ...td, opacity: 0.7 }}>
                              {r.last_sold_at ? r.last_sold_at.slice(0, 10) : "Hiç satılmadı"}
                            </td>
                            <td style={{ ...td, color: "#b91c1c", fontWeight: 700 }}>
                              {r.days_since_last_sale} gün
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {zeroSales.length > 20 && (
                      <div style={{ padding: "8px 12px", fontSize: 12, opacity: 0.6 }}>
                        +{zeroSales.length - 20} ürün daha — Ölü Stok sekmesinde tümünü görebilirsin.
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* ── ÖLÜ STOK ── */}
      {tab === "dead" && (
        <div style={card}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Ölü Stok</div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
              Stoğu {'>'} 0 olan, 21+ gündür hiç satış yapılmamış ürünler — en uzun süredir satılmayan en üstte
            </div>
          </div>

          {dead.length === 0 && !loading && (
            <div style={{ opacity: 0.6, padding: 8 }}>Harika — 21 günden eski ölü stok yok.</div>
          )}

          {dead.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Ürün", "Renk", "Beden", "Kategori", "Stok", "Son Satış", "Satışsız Gün"].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dead.map((r) => {
                    const isOld = r.days_since_last_sale >= 90;
                    const isMid = r.days_since_last_sale >= 45;
                    const color = isOld ? "#b91c1c" : isMid ? "#d97706" : "#374151";
                    return (
                      <tr key={r.barcode}>
                        <td style={tdBold}>{r.name}</td>
                        <td style={td}>{r.color ?? "—"}</td>
                        <td style={td}>{r.size ?? "—"}</td>
                        <td style={td}>{r.category ?? "—"}</td>
                        <td style={td}>{r.stock}</td>
                        <td style={{ ...td, opacity: 0.7 }}>
                          {r.last_sold_at ? r.last_sold_at.slice(0, 10) : "Hiç satılmadı"}
                        </td>
                        <td style={{ ...td, color, fontWeight: 700 }}>
                          {r.days_since_last_sale} gün
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── KATEGORİ KÂR MARJI ── */}
      {tab === "margin" && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Kategori Kâr Marjı</div>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                Sadece alış fiyatı girilmiş ürünler kâr hesabına dahil edilir.
                "Kâr Katkısı" = bu kategorinin toplam kâra oranı.
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {([30, 90, 180] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMarginDays(d)}
                  style={{
                    padding: "6px 12px", borderRadius: 8, border: "1px solid #e5e7eb",
                    background: marginDays === d ? "#111827" : "#fff",
                    color: marginDays === d ? "#fff" : "#111827",
                    cursor: "pointer", fontWeight: 700, fontSize: 12,
                  }}
                >
                  Son {d}g
                </button>
              ))}
            </div>
          </div>

          {margin.length === 0 && !loading && (
            <div style={{ opacity: 0.6, padding: 8 }}>Bu dönemde satış kaydı yok.</div>
          )}

          {margin.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Kategori", "Satış Adedi", "Ciro", "Maliyet", "Brüt Kâr", "Marj %", "Kâr Katkısı"].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {margin.map((r) => (
                    <tr key={r.category}>
                      <td style={tdBold}>{r.category}</td>
                      <td style={td}>{r.total_qty}</td>
                      <td style={td}>{fmtMoney(r.revenue)}</td>
                      <td style={{ ...td, opacity: r.cost === 0 ? 0.4 : 1 }}>
                        {r.cost === 0 ? "Alış fiyatı girilmemiş" : fmtMoney(r.cost)}
                      </td>
                      <td style={{ ...td, color: r.gross_profit > 0 ? "#059669" : "#b91c1c", fontWeight: 700 }}>
                        {fmtMoney(r.gross_profit)}
                      </td>
                      <td style={td}>{r.cost === 0 ? "—" : fmtPct(r.margin_pct)}</td>
                      <td style={td}>
                        {r.profit_share_pct > 0 ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{
                              height: 8, width: `${Math.max(4, r.profit_share_pct * 1.2)}px`,
                              background: "#111827", borderRadius: 4, maxWidth: 80,
                            }} />
                            <span style={{ fontWeight: 700 }}>{fmtPct(r.profit_share_pct)}</span>
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── SEPET ANALİZİ ── */}
      {tab === "basket" && (
        <div style={card}>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 800, fontSize: 16 }}>Sepet Analizi</div>
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
              Aynı fişte en sık birlikte satılan ürün çiftleri — vitrin ve çapraz satış kararları için
            </div>
          </div>

          {basket.length === 0 && !loading && (
            <div style={{ opacity: 0.6, padding: 8 }}>
              Birden fazla ürün içeren satış kaydı bulunamadı.
            </div>
          )}

          {basket.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Ürün A", "Ürün B", "Birlikte Satış"].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {basket.map((r, i) => (
                    <tr key={i}>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{r.name_a}</div>
                        {r.color_a && <div style={{ fontSize: 11, opacity: 0.6 }}>{r.color_a}</div>}
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>{r.name_b}</div>
                        {r.color_b && <div style={{ fontSize: 11, opacity: 0.6 }}>{r.color_b}</div>}
                      </td>
                      <td style={{ ...tdBold, color: r.together_count >= 5 ? "#111827" : "#374151" }}>
                        {r.together_count}x
                        {r.together_count >= 5 && (
                          <span style={{ marginLeft: 6, fontSize: 11, background: "#111827", color: "#fff", borderRadius: 4, padding: "2px 6px" }}>
                            Çok sık
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── DÜŞÜK STOK ── */}
      {tab === "lowstock" && (
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Düşük Stok Uyarısı</div>
              <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>
                Toplam stoğu eşik değeri veya altında olan aktif ürünler
              </div>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, opacity: 0.65 }}>Eşik:</span>
              {([2, 5, 10] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setLowStockThreshold(v)}
                  style={{
                    padding: "6px 12px", borderRadius: 8, border: "1px solid #e5e7eb",
                    background: lowStockThreshold === v ? "#111827" : "#fff",
                    color: lowStockThreshold === v ? "#fff" : "#111827",
                    cursor: "pointer", fontWeight: 700, fontSize: 12,
                  }}
                >
                  ≤ {v}
                </button>
              ))}
            </div>
          </div>

          {lowStock.length === 0 && !loading && (
            <div style={{ opacity: 0.6, padding: 8 }}>
              Stoğu ≤ {lowStockThreshold} olan ürün yok.
            </div>
          )}

          {lowStock.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["Ürün", "Renk", "Beden", "Kategori", "Mağaza", "Depo", "Toplam"].map((h) => (
                      <th key={h} style={th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lowStock.map((r) => {
                    const isZero = r.total_stock === 0;
                    const isCritical = r.total_stock <= 1;
                    const rowBg = isZero ? "#fff5f5" : isCritical ? "#fffbeb" : "#fff";
                    return (
                      <tr key={r.barcode} style={{ background: rowBg }}>
                        <td style={tdBold}>{r.name}</td>
                        <td style={td}>{r.color ?? "—"}</td>
                        <td style={td}>{r.size ?? "—"}</td>
                        <td style={td}>{r.category ?? "—"}</td>
                        <td style={td}>{r.magaza_stok}</td>
                        <td style={td}>{r.depo_stok}</td>
                        <td style={{
                          ...tdBold,
                          color: isZero ? "#b91c1c" : isCritical ? "#d97706" : "#111827",
                        }}>
                          {r.total_stock}
                          {isZero && <span style={{ marginLeft: 6, fontSize: 11, background: "#fee2e2", color: "#b91c1c", borderRadius: 4, padding: "1px 6px" }}>Tükendi</span>}
                          {!isZero && isCritical && <span style={{ marginLeft: 6, fontSize: 11, background: "#fef3c7", color: "#d97706", borderRadius: 4, padding: "1px 6px" }}>Kritik</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
