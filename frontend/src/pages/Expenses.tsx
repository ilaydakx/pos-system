import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { C, page, card, cardPadded, input, select as dsSelect, btnPrimary, btnSecondary, btnDanger, th as dsTh, td as dsTd, fieldLabel, errBox } from "../lib/ds";

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

  useEffect(() => { load(); }, []);

  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.amount) || 0), 0), [rows]);

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
    <div style={page}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>Giderler</h2>
        <button onClick={load} disabled={loading} style={{ ...btnSecondary, marginLeft: "auto" }}>
          Yenile
        </button>
      </div>

      {err && <div style={{ ...errBox, marginBottom: 16 }}>{err}</div>}

      {/* Add form */}
      <div style={{ ...cardPadded, marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: C.ink2, marginBottom: 16 }}>Gider Ekle</div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
            gap: 12,
            alignItems: "end",
          }}
        >
          <div>
            <label style={fieldLabel}>Dönem</label>
            <input
              value={periodAuto}
              readOnly
              style={{ ...input, backgroundColor: C.subtle, color: C.ink3 }}
            />
          </div>
          <div>
            <label style={fieldLabel}>Tarih</label>
            <input
              type="date"
              value={spentAt}
              onChange={(e) => setSpentAt(e.target.value)}
              style={input}
            />
          </div>
          <div>
            <label style={fieldLabel}>Kategori</label>
            <input
              placeholder="örn: Kargo, Kira, Poşet..."
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              style={input}
            />
          </div>
          <div>
            <label style={fieldLabel}>Tutar</label>
            <input
              placeholder="örn: 250"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              style={input}
            />
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <label style={fieldLabel}>Açıklama (opsiyonel)</label>
          <input
            placeholder="örn: Ocak kargo gideri"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            style={input}
          />
        </div>

        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button onClick={add} style={btnPrimary}>+ Gider Ekle</button>
        </div>
      </div>

      {/* Filters + summary */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <select
          value={periodFilter}
          onChange={(e) => setPeriodFilter(e.target.value)}
          style={{ ...dsSelect, width: "auto", minWidth: 140 }}
        >
          <option value="ALL">Tüm dönemler</option>
          {periods.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          style={{ ...dsSelect, width: "auto", minWidth: 160 }}
        >
          <option value="ALL">Tüm kategoriler</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <div style={{ marginLeft: "auto", fontSize: 14, color: C.ink2 }}>
          Toplam: <span style={{ fontWeight: 700 }}>{fmtMoney(total)}</span>
          <span style={{ color: C.ink4, marginLeft: 8 }}>{filteredRows.length} kayıt</span>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div style={{ padding: "32px 0", textAlign: "center", color: C.ink4, fontSize: 14 }}>Yükleniyor...</div>
      ) : grouped.length === 0 ? (
        <div style={{ ...cardPadded, color: C.ink4, textAlign: "center" }}>Henüz gider yok.</div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {grouped.map((g) => {
            const subtotal = g.rows.reduce((s, r) => s + (Number(r.amount) || 0), 0);
            return (
              <div key={g.period} style={card}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 12,
                    padding: "12px 16px",
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 15, color: C.ink }}>{g.period}</span>
                  <span style={{ fontSize: 13, color: C.ink3 }}>
                    Ara Toplam: <span style={{ fontWeight: 600, color: C.ink }}>{fmtMoney(subtotal)}</span>
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: C.ink4 }}>{g.rows.length} kayıt</span>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                    <thead>
                      <tr>
                        {["Tarih", "Kategori", "Açıklama", "Tutar", ""].map((h) => (
                          <th key={h} style={h === "Tutar" ? { ...dsTh, textAlign: "right" } : dsTh}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.id}>
                          <td style={dsTd}>{r.spent_at}</td>
                          <td style={dsTd}>{r.category ?? <span style={{ color: C.ink4 }}>—</span>}</td>
                          <td style={{ ...dsTd, color: r.note ? C.ink : C.ink4 }}>{r.note || "—"}</td>
                          <td style={{ ...dsTd, textAlign: "right", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                            {fmtMoney(r.amount)}
                          </td>
                          <td style={{ ...dsTd, textAlign: "right" }}>
                            <button
                              onClick={() => del(r.id)}
                              style={{ ...btnDanger, height: 30, padding: "0 10px", fontSize: 12 }}
                            >
                              Sil
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
