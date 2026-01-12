import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type Expense = {
  id: number;
  spent_at: string;
  period?: string | null;
  category?: string | null;
  amount: number;
  note?: string | null;
};

export function Expenses() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [rows, setRows] = useState<Expense[]>([]);

  // form
  const [spentAt, setSpentAt] = useState(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  const periodAuto = useMemo(() => derivePeriod(spentAt), [spentAt]);
  const [periodFilter, setPeriodFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");

  // form
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState("");

  const load = async () => {
    try {
      setErr("");
      setLoading(true);
      const data = await invoke<Expense[]>("list_expenses");
      setRows(data);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const total = useMemo(() => {
    return rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
  }, [rows]);

  const periods = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const p = (r.period ?? derivePeriod(r.spent_at) ?? "").toString();
      if (p) set.add(p);
    }
    return Array.from(set).sort().reverse();
  }, [rows]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const c = (r.category ?? "").toString().trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const p = (r.period ?? derivePeriod(r.spent_at) ?? "").toString();
      const c = (r.category ?? "").toString();
      if (periodFilter !== "ALL" && p !== periodFilter) return false;
      if (categoryFilter !== "ALL" && c !== categoryFilter) return false;
      return true;
    });
  }, [rows, periodFilter, categoryFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const r of filteredRows) {
      const p = (r.period ?? derivePeriod(r.spent_at) ?? "").toString() || "(Dönem yok)";
      const arr = map.get(p) ?? [];
      arr.push(r);
      map.set(p, arr);
    }

    for (const [, arr] of map) {
      arr.sort((a, b) => {
        const da = a.spent_at ?? "";
        const db = b.spent_at ?? "";
        if (da < db) return 1;
        if (da > db) return -1;
        return (b.id ?? 0) - (a.id ?? 0);
      });
    }

    const keys = Array.from(map.keys()).sort((a, b) => {
      if (a === "(Dönem yok)") return 1;
      if (b === "(Dönem yok)") return -1;
      return a < b ? 1 : a > b ? -1 : 0;
    });

    return keys.map((k) => ({ period: k, rows: map.get(k)! }));
  }, [filteredRows]);

  const add = async () => {
    try {
      setErr("");

      const amt = Number(amount);
      if (!spentAt.trim()) return setErr("Tarih zorunlu");
      if (!Number.isFinite(amt) || amt <= 0) return setErr("Tutar 0'dan büyük olmalı");

      await invoke<number>("add_expense", {
        payload: {
          spent_at: spentAt.trim(),
          period: periodAuto ? periodAuto : null,
          category: category.trim() ? category.trim() : null,
          amount: amt,
          note: note.trim() ? note.trim() : null,
        },
      });

      // UI güncelle
      await load();

      setAmount("");
      setNote("");
    } catch (e) {
      setErr(String(e));
    }
  };

  const del = async (id: number) => {
    const ok = window.confirm(`Gideri silmek istiyor musun? (id=${id})`);
    if (!ok) return;
    try {
      setErr("");
      await invoke<number>("delete_expense", { id });
      setRows((prev) => prev.filter((x) => x.id !== id));
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Giderler</h2>
        <button onClick={load} disabled={loading} style={{ marginLeft: "auto" }}>
          Yenile
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>
          ❌ {err}
        </div>
      )}

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 10 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "160px 220px minmax(220px, 1fr) 160px",
            gap: 14,
            alignItems: "end",
          }}
        >
          <div>
            <div style={labelStyle}>Dönem</div>
            <input
              value={periodAuto}
              readOnly
              style={inputReadOnlyStyle}
            />
          </div>

          <div>
            <div style={labelStyle}>Tarih</div>
            <input
              type="date"
              value={spentAt}
              onChange={(e) => setSpentAt(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <div style={labelStyle}>Kategori</div>
            <input
              placeholder="örn: Kargo, Kira, Poşet..."
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={inputStyle}
            />
          </div>

          <div>
            <div style={labelStyle}>Tutar</div>
            <input
              placeholder="örn: 250"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <div style={labelStyle}>Açıklama (opsiyonel)</div>
          <input
            placeholder="örn: Ocak kargo gideri"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={inputStyle}
          />
        </div>

        <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={add}>+ Gider Ekle</button>
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ opacity: 0.8 }}>
          Toplam: <b>{fmtMoney(total)}</b>
        </div>
        <div style={{ marginLeft: "auto", opacity: 0.8 }}>
          {filteredRows.length} kayıt
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={labelStyle}>Döneme göre</div>
          <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} style={selectStyle}>
            <option value="ALL">Tümü</option>
            {periods.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={labelStyle}>Kategoriye göre</div>
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} style={selectStyle}>
            <option value="ALL">Tümü</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ marginTop: 16 }}>Yükleniyor...</div>
      ) : (
        <div style={{ marginTop: 12 }}>
          {grouped.length === 0 ? (
            <div style={{ opacity: 0.7, padding: 12 }}>Henüz gider yok.</div>
          ) : (
            grouped.map((g) => {
              const subtotal = g.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
              return (
                <div key={g.period} style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "8px 0" }}>
                    <h3 style={{ margin: 0 }}>{g.period}</h3>
                    <div style={{ opacity: 0.75 }}>
                      Ara Toplam: <b>{fmtMoney(subtotal)}</b>
                    </div>
                    <div style={{ marginLeft: "auto", opacity: 0.75 }}>{g.rows.length} kayıt</div>
                  </div>

                  <div style={{ overflow: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 820 }}>
                      <thead>
                        <tr>
                          {["Tarih", "Kategori", "Açıklama", "Tutar", "Sil"].map((h) => (
                            <th
                              key={h}
                              style={{
                                textAlign: "left",
                                borderBottom: "1px solid #ddd",
                                padding: "10px 8px",
                                position: "sticky",
                                top: 0,
                                background: "white",
                              }}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {g.rows.map((r) => (
                          <tr key={r.id}>
                            <td style={cell}>{r.spent_at}</td>
                            <td style={cell}>{r.category ?? "-"}</td>
                            <td style={cell}>{r.note ?? "-"}</td>
                            <td style={cell}>{fmtMoney(r.amount)}</td>
                            <td style={cell}>
                              <button onClick={() => del(r.id)} style={{ cursor: "pointer" }}>
                                🗑
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f0f0f0",
  whiteSpace: "nowrap",
};
const labelStyle: React.CSSProperties = { fontSize: 12, opacity: 0.75, marginBottom: 6 };
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: 10,
  border: "1px solid #e5e7eb",
  borderRadius: 10,
  boxSizing: "border-box",
};
const inputReadOnlyStyle: React.CSSProperties = {
  ...inputStyle,
  background: "#fafafa",
};
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  padding: 8,
};
function derivePeriod(spentAt: string): string {
  const s = (spentAt || "").trim();
  if (s.length >= 7) return s.slice(0, 7); 
  return "";
}

function fmtMoney(v: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(v ?? 0);
}