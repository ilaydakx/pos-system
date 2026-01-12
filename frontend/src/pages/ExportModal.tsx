import React, { useMemo, useState } from "react";

type DayRow = {
  day: string; 
  qty?: number;
  net_ciro?: number;
};

type MonthRow = {
  month: string; 
  qty?: number;
  net_ciro?: number;
};

function fmtMoney(v: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(v) ? v : 0);
}

function todayStrTR() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function makeTurkishFilenameDaily(days: string[]) {
  const ts = todayStrTR();
  if (!days.length) return `Satışlar_Günlük_${ts}.csv`;
  const sorted = [...days].sort();
  const range =
    sorted.length === 1 ? sorted[0] : `${sorted[0]}_${sorted[sorted.length - 1]}`;
  return `Satışlar_Günlük_${range}_${ts}.csv`;
}

function makeTurkishFilenameMonthly(months: string[]) {
  const ts = todayStrTR();
  if (!months.length) return `Satışlar_Aylık_${ts}.csv`;
  const sorted = [...months].sort();
  const range =
    sorted.length === 1 ? sorted[0] : `${sorted[0]}_${sorted[sorted.length - 1]}`;
  return `Satışlar_Aylık_${range}_${ts}.csv`;
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.35)",
  display: "grid",
  placeItems: "center",
  zIndex: 9999,
  padding: 16,
};

const modal: React.CSSProperties = {
  width: "min(980px, 100%)",
  maxHeight: "min(720px, 90vh)",
  overflow: "hidden",
  background: "white",
  borderRadius: 16,
  boxShadow: "0 12px 40px rgba(0,0,0,.18)",
  border: "1px solid #eee",
};

const header: React.CSSProperties = {
  padding: "14px 16px",
  borderBottom: "1px solid #eee",
  display: "flex",
  alignItems: "center",
  gap: 12,
};

const body: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 320px",
  gap: 14,
  padding: 16,
};

const tabsRow: React.CSSProperties = { display: "flex", gap: 8 };

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "8px 12px",
  borderRadius: 999,
  border: "1px solid #ddd",
  cursor: "pointer",
  background: active ? "#111" : "white",
  color: active ? "white" : "#111",
  fontWeight: 700,
  fontSize: 13,
});

const listBox: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 14,
  overflow: "hidden",
  display: "grid",
  gridTemplateRows: "auto 1fr",
  minHeight: 420,
};

const listHeader: React.CSSProperties = {
  padding: 12,
  borderBottom: "1px solid #eee",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  background: "#fafafa",
};

const listScroll: React.CSSProperties = {
  overflow: "auto",
  padding: 8,
};

const rowItem: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 10px",
  borderRadius: 12,
};

const sideCard: React.CSSProperties = {
  border: "1px solid #eee",
  borderRadius: 14,
  padding: 12,
  background: "#fcfcfc",
  height: "fit-content",
};

const smallBtn: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 10,
  border: "1px solid #ddd",
  background: "white",
  cursor: "pointer",
  fontWeight: 700,
  fontSize: 13,
};

const primaryBtn: React.CSSProperties = {
  ...smallBtn,
  background: "#111",
  color: "white",
  borderColor: "#111",
};

export default function ExportModal(props: {
  open: boolean;
  onClose: () => void;

  dailyRows: DayRow[];     
  monthlyRows: MonthRow[];  

  onExportDaily: (days: string[], filename: string) => Promise<void> | void;
  onExportMonthly: (months: string[], filename: string) => Promise<void> | void;
}) {
  const { open, onClose, dailyRows, monthlyRows, onExportDaily, onExportMonthly } = props;

  const [tab, setTab] = useState<"daily" | "monthly">("daily");
  const [busy, setBusy] = useState(false);

  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);


  const daySet = useMemo(() => new Set(selectedDays), [selectedDays]);
  const monthSet = useMemo(() => new Set(selectedMonths), [selectedMonths]);

  const daySummary = useMemo(() => {
    if (!selectedDays.length) return { qty: 0, ciro: 0 };
    let qty = 0;
    let ciro = 0;
    for (const r of dailyRows) {
      if (daySet.has(r.day)) {
        qty += r.qty ?? 0;
        ciro += r.net_ciro ?? 0;
      }
    }
    return { qty, ciro };
  }, [dailyRows, daySet, selectedDays.length]);

  const monthSummary = useMemo(() => {
    if (!selectedMonths.length) return { qty: 0, ciro: 0 };
    let qty = 0;
    let ciro = 0;
    for (const r of monthlyRows) {
      if (monthSet.has(r.month)) {
        qty += r.qty ?? 0;
        ciro += r.net_ciro ?? 0;
      }
    }
    return { qty, ciro };
  }, [monthlyRows, monthSet, selectedMonths.length]);

  const toggleDay = (d: string) => {
    setSelectedDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  const toggleMonth = (m: string) => {
    setSelectedMonths((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  };

  const selectAllDaily = () => setSelectedDays(dailyRows.map((r) => r.day));
  const clearDaily = () => setSelectedDays([]);

  const selectAllMonthly = () => setSelectedMonths(monthlyRows.map((r) => r.month));
  const clearMonthly = () => setSelectedMonths([]);

  const canExportDaily = selectedDays.length > 0;
  const canExportMonthly = selectedMonths.length > 0;

  const runExportDaily = async () => {
    if (!canExportDaily) return;
    const filename = makeTurkishFilenameDaily(selectedDays);
    setBusy(true);
    try {
      await onExportDaily([...selectedDays].sort(), filename);
    } finally {
      setBusy(false);
    }
  };

  const runExportMonthly = async () => {
    if (!canExportMonthly) return;
    const filename = makeTurkishFilenameMonthly(selectedMonths);
    setBusy(true);
    try {
      await onExportMonthly([...selectedMonths].sort(), filename);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div style={overlay} onMouseDown={onClose}>
      <div
        style={modal}
        onMouseDown={(e) => {
          e.stopPropagation();
        }}
      >
        <div style={header}>
          <div style={{ fontWeight: 900, fontSize: 16 }}>📤 Dışa Aktar</div>
          <div style={{ opacity: 0.7, fontSize: 13 }}>
            Gün veya ay seç → CSV indir
          </div>

          <div style={{ marginLeft: "auto" }}>
            <button onClick={onClose} style={smallBtn} disabled={busy}>
              Kapat
            </button>
          </div>
        </div>

        <div style={body}>
          {/* SOL: Seçim listesi */}
          <div style={{ display: "grid", gap: 12 }}>
            <div style={tabsRow}>
              <button
                style={tabBtn(tab === "daily")}
                onClick={() => setTab("daily")}
                disabled={busy}
              >
                Günlük
              </button>
              <button
                style={tabBtn(tab === "monthly")}
                onClick={() => setTab("monthly")}
                disabled={busy}
              >
                Aylık
              </button>
            </div>

            <div style={listBox}>
              <div style={listHeader}>
                <div style={{ fontWeight: 800 }}>
                  {tab === "daily" ? "Gün Seç" : "Ay Seç"}
                </div>

                {tab === "daily" ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={selectAllDaily} style={smallBtn} disabled={busy || !dailyRows.length}>
                      Hepsini seç
                    </button>
                    <button onClick={clearDaily} style={smallBtn} disabled={busy || !selectedDays.length}>
                      Temizle
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={selectAllMonthly} style={smallBtn} disabled={busy || !monthlyRows.length}>
                      Hepsini seç
                    </button>
                    <button onClick={clearMonthly} style={smallBtn} disabled={busy || !selectedMonths.length}>
                      Temizle
                    </button>
                  </div>
                )}
              </div>

              <div style={listScroll}>
                {tab === "daily" ? (
                  dailyRows.length ? (
                    <div style={{ display: "grid", gap: 6 }}>
                      {dailyRows.map((r) => {
                        const checked = daySet.has(r.day);
                        return (
                          <label
                            key={r.day}
                            style={{
                              ...rowItem,
                              border: checked ? "1px solid #111" : "1px solid transparent",
                              background: checked ? "#fff" : "transparent",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleDay(r.day)}
                              disabled={busy}
                            />
                            <div style={{ display: "grid", gap: 2 }}>
                              <div style={{ fontWeight: 900 }}>{r.day}</div>
                              <div style={{ fontSize: 12, opacity: 0.7 }}>
                                {typeof r.qty === "number" ? `${r.qty} adet` : "-"}
                                {" • "}
                                {typeof r.net_ciro === "number" ? fmtMoney(r.net_ciro) : "-"}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ padding: 12, opacity: 0.7 }}>Günlük veri yok.</div>
                  )
                ) : monthlyRows.length ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    {monthlyRows.map((r) => {
                      const checked = monthSet.has(r.month);
                      return (
                        <label
                          key={r.month}
                          style={{
                            ...rowItem,
                            border: checked ? "1px solid #111" : "1px solid transparent",
                            background: checked ? "#fff" : "transparent",
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleMonth(r.month)}
                            disabled={busy}
                          />
                          <div style={{ display: "grid", gap: 2 }}>
                            <div style={{ fontWeight: 900 }}>{r.month}</div>
                            <div style={{ fontSize: 12, opacity: 0.7 }}>
                              {typeof r.qty === "number" ? `${r.qty} adet` : "-"}
                              {" • "}
                              {typeof r.net_ciro === "number" ? fmtMoney(r.net_ciro) : "-"}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div style={{ padding: 12, opacity: 0.7 }}>Aylık veri yok.</div>
                )}
              </div>
            </div>
          </div>

          {/* SAĞ: Özet + indir */}
          <div style={{ display: "grid", gap: 12 }}>
            <div style={sideCard}>
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Seçim Özeti</div>

              {tab === "daily" ? (
                <>
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    Seçili gün: <b>{selectedDays.length}</b>
                  </div>
                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.7 }}>Adet</span>
                      <b>{daySummary.qty}</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.7 }}>Net Ciro</span>
                      <b>{fmtMoney(daySummary.ciro)}</b>
                    </div>
                  </div>

                  <button
                    style={{ ...primaryBtn, width: "100%", marginTop: 12, opacity: canExportDaily ? 1 : 0.5 }}
                    onClick={runExportDaily}
                    disabled={busy || !canExportDaily}
                  >
                    {busy ? "İndiriliyor..." : "Günlük CSV İndir"}
                  </button>

                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65, lineHeight: 1.35 }}>
                    Dosya adı örneği:
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {makeTurkishFilenameDaily(selectedDays)}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 13, opacity: 0.75 }}>
                    Seçili ay: <b>{selectedMonths.length}</b>
                  </div>
                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.7 }}>Adet</span>
                      <b>{monthSummary.qty}</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ opacity: 0.7 }}>Net Ciro</span>
                      <b>{fmtMoney(monthSummary.ciro)}</b>
                    </div>
                  </div>

                  <button
                    style={{ ...primaryBtn, width: "100%", marginTop: 12, opacity: canExportMonthly ? 1 : 0.5 }}
                    onClick={runExportMonthly}
                    disabled={busy || !canExportMonthly}
                  >
                    {busy ? "İndiriliyor..." : "Aylık CSV İndir"}
                  </button>

                  <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65, lineHeight: 1.35 }}>
                    Dosya adı örneği:
                    <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
                      {makeTurkishFilenameMonthly(selectedMonths)}
                    </div>
                  </div>
                </>
              )}
            </div>

            
          </div>
        </div>

        <div style={{ padding: "0 16px 14px 16px", opacity: 0.65, fontSize: 12 }}>
          İpucu: Çoklu seçim için listede birden fazla günü/ayı işaretleyebilirsin.
        </div>
      </div>
    </div>
  );
}