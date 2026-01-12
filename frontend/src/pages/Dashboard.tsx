import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ExportModal from "./ExportModal";
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  BarChart,
} from "recharts";

type RangeDays = 7 | 14 | 30;

type DailyRow = {
  day: string; 
  net_qty: number;
  net_revenue: number;
  gross_profit: number;
  avg_basket: number;
};

type MonthlyRow = {
  period: string; 
  net_qty: number;
  net_revenue: number;
  gross_profit: number;
  expense: number;
  net_profit: number;
  avg_basket: number;
};


type DashboardSummary = {
  kpi: {
    today_qty: number;
    today_net_revenue: number;
    month_gross_profit: number;
    month_net_profit: number;
    month_avg_basket: number;
    month_expense: number;
  };
  daily: DailyRow[];
  monthly: MonthlyRow[];
};

type CashReportRow = {
  day: string;        
  cash_net: number;
  card_net: number;
  net_total: number;
};



export function Dashboard() {
  const [rangeDays, setRangeDays] = useState<RangeDays>(30);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [cashDays, setCashDays] = useState<7 | 15 | 30 | 9999>(30);
  const [cashRows, setCashRows] = useState<CashReportRow[]>([]);
  const [cashDetailOpen, setCashDetailOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; kind: "ok" | "err" } | null>(null);
  const showToast = (msg: string, kind: "ok" | "err" = "ok") => {
    setToast({ msg, kind });
    window.setTimeout(() => setToast(null), 2200);
  };

  const load = async () => {
    try {
      setErr("");
      setLoading(true);

      // Günlük kasa 
      const daysArg = cashDays === 9999 ? 3650 : cashDays; 
      const cash = await invoke<CashReportRow[]>("get_cash_report", { days: daysArg });
      setCashRows(cash);


      const res = await invoke<DashboardSummary>("get_dashboard_summary", {
        days: rangeDays,
        months: 12,
      });
      setData(res);
    } catch (e) {
      setErr(String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [rangeDays, cashDays]);


  const dailyRows = (data?.daily ?? []).filter((r) => {
    // satış/iade etkisi olan günler
    return (
      (r.net_qty ?? 0) !== 0 ||
      (r.net_revenue ?? 0) !== 0 ||
      (r.gross_profit ?? 0) !== 0
    );
  });

  const monthlyRows = (data?.monthly ?? []).filter((r) => {
    // satış/iade veya gider olan aylar
    return (
      (r.net_qty ?? 0) !== 0 ||
      (r.net_revenue ?? 0) !== 0 ||
      (r.gross_profit ?? 0) !== 0 ||
      (r.expense ?? 0) !== 0 ||
      (r.net_profit ?? 0) !== 0
    );
  });

  const exportDailyRows = dailyRows.map((r) => ({
    day: r.day,
    qty: r.net_qty ?? 0,
    net_ciro: r.net_revenue ?? 0,
  }));



  const exportMonthlyRows = monthlyRows.map((r) => ({
    month: r.period,
    qty: r.net_qty ?? 0,
    net_ciro: r.net_revenue ?? 0,
  }));

  const exportDaily = async (days: string[], filename: string) => {
    const set = new Set(days);
    const rows = dailyRows
      .filter((r) => set.has(r.day))
      .sort((a, b) => a.day.localeCompare(b.day));

    const csv = toCsv(
      rows,
      ["Tarih", "Net Adet", "Net Ciro", "Brüt Kâr", "Ortalama Sepet"],
      (r) => [r.day, r.net_qty, r.net_revenue, r.gross_profit, r.avg_basket]
    );

    try {
      downloadCsv(filename, csv);
      showToast("✅ İndirildi", "ok");
    } catch (e) {
      showToast("❌ İndirilemedi", "err");
    }
  };

  const exportMonthly = async (months: string[], filename: string) => {
    const set = new Set(months);
    const rows = monthlyRows
      .filter((r) => set.has(r.period))
      .sort((a, b) => a.period.localeCompare(b.period));

    const csv = toCsv(
      rows,
      ["Dönem", "Net Adet", "Net Ciro", "Brüt Kâr", "Gider", "Net Kâr", "Ortalama Sepet"],
      (r) => [r.period, r.net_qty, r.net_revenue, r.gross_profit, r.expense, r.net_profit, r.avg_basket]
    );

    try {
      downloadCsv(filename, csv);
      showToast("✅ İndirildi", "ok");
    } catch (e) {
      showToast("❌ İndirilemedi", "err");
    }
  };
  const dailyChartData = dailyRows.map((r) => ({
    day: r.day.slice(5), 
    net_qty: r.net_qty ?? 0,
    net_revenue: r.net_revenue ?? 0,
  }));

  const monthlyChartData = monthlyRows.map((r) => ({
    period: r.period, 
    net_revenue: r.net_revenue ?? 0,
    gross_profit: r.gross_profit ?? 0,
  }));

  const COLORS = {
    blush: "#FFF3EE",
    blush2: "#FFF7F3",
    sand: "#FFF8F0",

    accent: "#F3B6A6",
    accent2: "#E9A896",

    text: "#111827",
    subtext: "#6B7280",
    border: "#EEE8E4",
  } as const;
  const pickNum = (obj: any, keys: string[], fallback = 0) => {
    for (const k of keys) {
      const v = obj?.[k];
      if (v === 0) return 0;
      if (v === null || v === undefined) continue;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isNaN(n)) return n;
    }
    return fallback;
  };

  const kpiAny: any = data?.kpi ?? {};

  const todayQty = pickNum(kpiAny, ["today_qty", "todayQty"], 0);
  const todayCiro = pickNum(kpiAny, ["today_net_revenue", "todayNetRevenue", "today_ciro", "todayCiro"], 0);

  const monthBrutKar = pickNum(kpiAny, ["month_gross_profit", "monthGrossProfit", "month_brut_kar", "monthBrutKar"], 0);
  const monthNetKar  = pickNum(kpiAny, ["month_net_profit", "monthNetProfit", "month_net_kar", "monthNetKar"], 0);

  const monthAvgSepet = pickNum(kpiAny, ["month_avg_basket", "monthAvgBasket", "month_avg_sepet", "monthAvgSepet"], 0);
  const monthGider    = pickNum(kpiAny, ["month_expense", "monthExpense", "month_gider", "monthGider"], 0);

  // --- Günlük Kasa helpers for dynamic detail ---
  const cashDaysLabel = cashDays === 9999 ? "Tümü" : `Son ${cashDays}`;
  const cashRowsDesc = [...cashRows].sort((a, b) => b.day.localeCompare(a.day));

  return (
    <div style={page}>
      <div style={headerRow}>
        <div>
          <div style={title}>Dashboard</div>
        </div>

        <button style={btnSoft} onClick={load} disabled={loading}>
          {loading ? "Yükleniyor…" : "Yenile"}
        </button>
      </div>

      {/* KPI cards */}
      <div style={kpiGrid}>
        <KpiCard
          title="Bugün Satış Adedi"
          value={String(todayQty)}
          hint="Net (iade düşülür)"
          tint={COLORS.blush2}
          accent={COLORS.accent}
        />
        <KpiCard
          title="Bugün Ciro"
          value={fmtMoney(todayCiro)}
          hint="Net ciro"
          tint={COLORS.sand}
          accent={COLORS.accent2}
        />
        <KpiCard
          title="Bu Ay Brüt Kâr"
          value={fmtMoney(monthBrutKar)}
          hint="Gider hariç"
          tint={COLORS.blush2}
          accent={COLORS.accent}
        />
        <KpiCard
          title="Bu Ay Net Kâr"
          value={fmtMoney(monthNetKar)}
          hint="Gider dahil"
          tint={COLORS.sand}
          accent={COLORS.accent2}
        />
        <KpiCard
          title="Bu Ay Ortalama Sepet"
          value={fmtMoney(monthAvgSepet)}
          hint="Net ciro / fiş"
          tint={COLORS.blush2}
          accent={COLORS.accent}
        />
        <KpiCard
          title="Bu Ay Gider"
          value={fmtMoney(monthGider)}
          hint="Giderler toplamı"
          tint={COLORS.sand}
          accent={COLORS.accent2}
        />
      </div>
      {/* Günlük Kasa */}
      <div
        style={{
          gridColumn: "1 / -1",
          borderRadius: 18,
          border: "1px solid rgba(0,0,0,0.06)",
          background: "rgba(255,255,255,0.35)",
          padding: 16,
          marginTop: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>📅 Günlük Kasa</div>

            {/* Filtre */}
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { label: "Son 7", v: 7 as const },
                { label: "Son 15", v: 15 as const },
                { label: "Son 30", v: 30 as const },
                { label: "Tümü", v: 9999 as const },
              ].map((x) => (
                <button
                  key={x.v}
                  onClick={() => setCashDays(x.v)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 999,
                    border: "1px solid rgba(0,0,0,0.10)",
                    background: cashDays === x.v ? "#111827" : "white",
                    color: cashDays === x.v ? "white" : "#111827",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {x.label}
                </button>
              ))}
            </div>
          </div>

          {/* Detay butonu */}
          <button
            onClick={() => setCashDetailOpen((s) => !s)}
            style={{
              padding: "8px 12px",
              borderRadius: 12,
              border: "1px solid rgba(0,0,0,0.10)",
              background: "white",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            {cashDetailOpen ? "Kapat" : "Detay"}
          </button>
        </div>

        {/* Kapalıyken sadece son 2 gün */}
        {(() => {
          const rowsToShow = cashDetailOpen ? cashRowsDesc : cashRowsDesc.slice(0, 2);
          const empty = rowsToShow.length === 0;

          return (
            <div
              style={{
                marginTop: 12,
                borderRadius: 14,
                overflow: "hidden",
                border: "1px solid rgba(0,0,0,0.06)",
                background: "rgba(255,255,255,0.55)",
              }}
            >
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                  <thead>
                    <tr style={{ background: "rgba(0,0,0,0.03)" }}>
                      <th style={{ textAlign: "left", padding: 12, fontWeight: 800 }}>Tarih</th>
                      <th style={{ textAlign: "right", padding: 12, fontWeight: 800 }}>Nakit</th>
                      <th style={{ textAlign: "right", padding: 12, fontWeight: 800 }}>Kart</th>
                      <th style={{ textAlign: "right", padding: 12, fontWeight: 800 }}>Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {empty ? (
                      <tr>
                        <td colSpan={4} style={{ padding: 16, opacity: 0.65 }}>
                          Kayıt yok.
                        </td>
                      </tr>
                    ) : (
                      rowsToShow.map((r) => (
                        <tr key={r.day} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                          <td style={{ padding: 12 }}>{r.day}</td>
                          <td style={{ padding: 12, textAlign: "right" }}>{r.cash_net.toFixed(2)} ₺</td>
                          <td style={{ padding: 12, textAlign: "right" }}>{r.card_net.toFixed(2)} ₺</td>
                          <td style={{ padding: 12, textAlign: "right", fontWeight: 800 }}>
                            {r.net_total.toFixed(2)} ₺
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {/* Detay açılınca: seçili gün detayı ayrı kutuda */}
        {cashDetailOpen && (
          <div
            style={{
              marginTop: 12,
              borderRadius: 14,
              border: "1px dashed rgba(0,0,0,0.18)",
              padding: 12,
              background: "rgba(255,255,255,0.35)",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 8 }}>{cashDaysLabel} Kasa Detayı</div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 520 }}>
                <thead>
                  <tr style={{ background: "rgba(0,0,0,0.03)" }}>
                    <th style={{ textAlign: "left", padding: 10 }}>Tarih</th>
                    <th style={{ textAlign: "right", padding: 10 }}>Nakit</th>
                    <th style={{ textAlign: "right", padding: 10 }}>Kart</th>
                    <th style={{ textAlign: "right", padding: 10 }}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  {cashRowsDesc.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 12, opacity: 0.65 }}>
                        Kayıt yok.
                      </td>
                    </tr>
                  ) : (
                    cashRowsDesc.map((r) => (
                      <tr key={r.day} style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                        <td style={{ padding: 10 }}>{r.day}</td>
                        <td style={{ padding: 10, textAlign: "right" }}>{r.cash_net.toFixed(2)} ₺</td>
                        <td style={{ padding: 10, textAlign: "right" }}>{r.card_net.toFixed(2)} ₺</td>
                        <td style={{ padding: 10, textAlign: "right", fontWeight: 800 }}>
                          {r.net_total.toFixed(2)} ₺
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
      {err && (
        <div style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>
          ❌ {err}
        </div>
      )}

      {/* Charts row */}
      <div style={chartsGrid}>
        <Card>
          <div style={cardHeadRow}>
            <div>
              <div style={cardTitle}>Günlük Adet & Net Ciro</div>
              <div style={cardHint}>Son {rangeDays} gün</div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <Segmented value={rangeDays} options={[7, 14, 30]} onChange={(v) => setRangeDays(v as RangeDays)} />
            </div>
          </div>

          <div style={{ ...chartPlaceholder, padding: 12, height: 300, overflow: "visible" }}>
            {dailyChartData.length === 0 ? (
              <div style={{ opacity: 0.7 }}>Veri yok.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={dailyChartData}
                  margin={{ top: 10, right: 34, left: 10, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" width={42} tick={{ fontSize: 12 }} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    width={86}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => fmtMoney(Number(v))}
                  />
                  <Tooltip
                    formatter={(value: any, name: any) => {
                      if (name === "Net Ciro") return [fmtMoney(Number(value)), name];
                      return [value, name];
                    }}
                  />
                  <Legend />
                  <Bar
                    yAxisId="left"
                    dataKey="net_qty"
                    name="Adet"
                    radius={[8, 8, 0, 0]}
                    fill="#F3B6A6"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="net_revenue"
                    name="Net Ciro"
                    stroke="#111827"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        <Card>
          <div style={cardHeadRow}>
            <div>
              <div style={cardTitle}>Aylık Net Ciro & Brüt Kâr</div>
              <div style={cardHint}>Son 12 ay</div>
            </div>
          </div>

          <div style={{ ...chartPlaceholder, padding: 12, height: 300, overflow: "visible" }}>
            {monthlyChartData.length === 0 ? (
              <div style={{ opacity: 0.7 }}>Veri yok.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthlyChartData}
                  margin={{ top: 10, right: 28, left: 10, bottom: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis
                    width={86}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => fmtMoney(Number(v))}
                  />
                  <Tooltip formatter={(value: any, name: any) => [fmtMoney(Number(value)), name]} />
                  <Legend />
                  <Bar
                    dataKey="net_revenue"
                    name="Net Ciro"
                    radius={[8, 8, 0, 0]}
                    fill="#F3B6A6"
                  />
                  <Bar
                    dataKey="gross_profit"
                    name="Brüt Kâr"
                    radius={[8, 8, 0, 0]}
                    fill="#111827"
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Tables */}
      <div style={tablesGrid}>
        <Card>
          <div style={cardHeadRow}>
            <div>
              <div style={cardTitle}>Günlük Tablo</div>
            </div>
            <button style={btnSoft} onClick={() => setExportOpen(true)}>
              Dışa Aktar
            </button>
          </div>

          <div style={{ overflow: "auto" }}>
            <table style={table}>
              <thead>
                <tr>
                  {["Tarih", "Net Adet", "Net Ciro", "Brüt Kâr", "Ortalama Sepet"].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((r) => (
                  <tr key={r.day}>
                    <td style={td}>{r.day}</td>
                    <td style={td}>{r.net_qty}</td>
                    <td style={td}>{fmtMoney(r.net_revenue)}</td>
                    <td style={td}>{fmtMoney(r.gross_profit)}</td>
                    <td style={td}>{fmtMoney(r.avg_basket)}</td>
                  </tr>
                ))}

                {!loading && dailyRows.length === 0 && (
                  <tr>
                    <td style={{ padding: 12, opacity: 0.7 }} colSpan={5}>
                      Veri yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <div style={cardHeadRow}>
            <div>
              <div style={cardTitle}>Aylık Tablo</div>
            </div>
            <button style={btnSoft} onClick={() => setExportOpen(true)}>
              Dışa Aktar
            </button>
          </div>

          <div style={{ overflow: "auto" }}>
            <table style={table}>
              <thead>
                <tr>
                  {["Dönem", "Net Adet", "Net Ciro", "Brüt Kâr", "Gider", "Net Kâr", "Ortalama Sepet"].map((h) => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((r) => (
                  <tr key={r.period}>
                    <td style={td}>{r.period}</td>
                    <td style={td}>{r.net_qty}</td>
                    <td style={td}>{fmtMoney(r.net_revenue)}</td>
                    <td style={td}>{fmtMoney(r.gross_profit)}</td>
                    <td style={td}>{fmtMoney(r.expense)}</td>
                    <td style={td}>{fmtMoney(r.net_profit)}</td>
                    <td style={td}>{fmtMoney(r.avg_basket)}</td>
                  </tr>
                ))}

                {!loading && monthlyRows.length === 0 && (
                  <tr>
                    <td style={{ padding: 12, opacity: 0.7 }} colSpan={7}>
                      Veri yok.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
            {toast && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 9999,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid rgba(0,0,0,0.10)",
            background: toast.kind === "ok" ? "#111827" : "crimson",
            color: "white",
            fontWeight: 800,
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
            maxWidth: 260,
          }}
        >
          {toast.msg}
        </div>
      )}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        dailyRows={exportDailyRows}
        monthlyRows={exportMonthlyRows}
        onExportDaily={exportDaily}
        onExportMonthly={exportMonthly}
      />
    </div>
  );
}

/* ---------------- UI components ---------------- */

function Card({ children }: { children: React.ReactNode }) {
  return <div style={card}>{children}</div>;
}

function KpiCard({
  title,
  value,
  hint,
  tint,
  accent,
}: {
  title: string;
  value: string;
  hint?: string;
  tint?: string;
  accent?: string;
}) {
  return (
    <div style={{ ...kpiCard, background: "white" }}>
      <div style={kpiTop}>
        <div style={kpiTitle}>{title}</div>
        <div
          style={{
            ...kpiDot,
            background: accent ?? "#F3B6A6",
          }}
        />
      </div>

      <div style={kpiValue}>{value}</div>

      {hint ? <div style={kpiHint}>{hint}</div> : <div style={kpiHint}>&nbsp;</div>}

      {/* very subtle tint at the bottom */}
      <div
        style={{
          ...kpiTint,
          background: tint ?? "#FFF7F3",
        }}
      />
    </div>
  );
}

function Segmented({
  value,
  options,
  onChange,
}: {
  value: number;
  options: number[];
  onChange: (v: number) => void;
}) {
  return (
    <div style={segWrap}>
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            style={{ ...segBtn, ...(active ? segBtnActive : null) }}
          >
            {opt}g
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Styles ---------------- */

const page: React.CSSProperties = {
  padding: 18,
  fontFamily: "system-ui",
  background: "#F7F6F5",
  minHeight: "100%",
};

const headerRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 14,
};

const title: React.CSSProperties = { fontSize: 28, fontWeight: 800, color: "#111827" };

const kpiGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, minmax(180px, 1fr))",
  gap: 14,
};

const chartsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 14,
  marginTop: 14,
};

const tablesGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr",
  gap: 14,
  marginTop: 14,
};

const card: React.CSSProperties = {
  background: "white",
  border: "1px solid #EEE8E4",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 8px 24px rgba(17, 24, 39, 0.06)",
};

const cardHeadRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginBottom: 12,
};

const cardTitle: React.CSSProperties = { fontSize: 16, fontWeight: 800, color: "#111827" };
const cardHint: React.CSSProperties = { fontSize: 12, opacity: 0.65, marginTop: 2 };

const kpiCard: React.CSSProperties = {
  background: "white",
  border: "1px solid #EEE8E4",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 8px 24px rgba(17, 24, 39, 0.06)",
  minHeight: 86,
};

const kpiTitle: React.CSSProperties = { fontSize: 12, opacity: 0.75, marginBottom: 8 };
const kpiValue: React.CSSProperties = { fontSize: 24, fontWeight: 900, color: "#111827" };
const kpiHint: React.CSSProperties = { fontSize: 12, opacity: 0.6, marginTop: 6 };

const kpiTop: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const kpiDot: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  boxShadow: "0 0 0 4px rgba(243, 182, 166, 0.20)",
};

const kpiTint: React.CSSProperties = {
  marginTop: 12,
  height: 10,
  borderRadius: 999,
  opacity: 0.9,
};

const chartPlaceholder: React.CSSProperties = {
  border: "1px solid #EEE8E4",
  borderRadius: 14,
  background: "#FFF7F3",
  overflow: "visible", 
};

const table: React.CSSProperties = { width: "100%", borderCollapse: "collapse", minWidth: 880 };

const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 12,
  fontWeight: 700,
  color: "#374151",
  padding: "10px 10px",
  borderBottom: "1px solid #e5e7eb",
  position: "sticky",
  top: 0,
  background: "#FFFBF9",
};

const td: React.CSSProperties = {
  padding: "12px 10px",
  borderBottom: "1px solid #f3f4f6",
  whiteSpace: "nowrap",
};

const btnSoft: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  background: "white",
  borderRadius: 12,
  padding: "10px 12px",
  cursor: "pointer",
  boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
};

const segWrap: React.CSSProperties = {
  display: "inline-flex",
  border: "1px solid #e5e7eb",
  background: "white",
  borderRadius: 12,
  overflow: "hidden",
  boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
};

const segBtn: React.CSSProperties = {
  border: "none",
  background: "transparent",
  padding: "10px 12px",
  cursor: "pointer",
  fontSize: 12,
  opacity: 0.8,
};

const segBtnActive: React.CSSProperties = { background: "#111827", color: "white", opacity: 1 };

function fmtMoney(v: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(v ?? 0);
}
function downloadCsv(filename: string, csvText: string) {
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toCsv(rows: any[], headers: string[], mapRow: (r: any) => (string | number)[]) {
  const esc = (v: any) => {
    const s = String(v ?? "");
    // virgül / tırnak / satır sonu varsa quote’la
    if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
    return s;
  };

  const lines = [
    headers.map(esc).join(","),
    ...rows.map((r) => mapRow(r).map(esc).join(",")),
  ];
  return lines.join("\n");
}