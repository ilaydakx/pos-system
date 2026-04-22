import React, { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";

type Product = {
  barcode: string;
  name: string;
  color?: string | null;
  size?: string | null;
  magaza_stok: number;
  depo_stok: number;
};

type Loc = "MAGAZA" | "DEPO";

type CartLine = {
  barcode: string;
  name: string;
  color?: string | null;
  size?: string | null;
  qty: number;
  from_loc: Loc;
  to_loc: Loc;
};

export function Transfer() {
  const [err, setErr]             = useState<string>("");
  const [busy, setBusy]           = useState(false);
  const [barcode, setBarcode]     = useState("");
  const [defaultFrom, setDefaultFrom] = useState<Loc>("MAGAZA");
  const [note, setNote]           = useState("");
  const [cart, setCart]           = useState<CartLine[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setCart([]);
    setBarcode("");
    setErr("");
    setNote("");
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const addByBarcode = async (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    setErr("");
    setBusy(true);
    try {
      const p = await invoke<Product | null>("find_product", { barcode: code });
      if (!p) { setErr(`Ürün bulunamadı: ${code}`); return; }
      setCart((prev) => {
        const idx = prev.findIndex((x) => x.barcode === p.barcode);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
          return next;
        }
        const from_loc = defaultFrom;
        const to_loc: Loc = from_loc === "MAGAZA" ? "DEPO" : "MAGAZA";
        return [{ barcode: p.barcode, name: p.name, color: p.color ?? null, size: p.size ?? null, qty: 1, from_loc, to_loc }, ...prev];
      });
      setBarcode("");
      setTimeout(() => inputRef.current?.focus(), 10);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateLine = (bc: string, patch: Partial<CartLine>) => {
    setCart((prev) =>
      prev.map((l) => {
        if (l.barcode !== bc) return l;
        const next: CartLine = { ...l, ...patch };
        next.qty = Math.max(1, Number(next.qty ?? 1));
        if (next.from_loc === next.to_loc) {
          next.to_loc = next.from_loc === "MAGAZA" ? "DEPO" : "MAGAZA";
        }
        return next;
      })
    );
  };

  const removeLine = (bc: string) => {
    setCart((prev) => prev.filter((l) => l.barcode !== bc));
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const commitTransfer = async () => {
    if (cart.length === 0) { setErr("Sepet boş."); return; }
    const ok = await confirm(`Transferi kaydetmek istiyor musun?\nSatır: ${cart.length}`,
      { title: "Transfer Onayı", kind: "warning" }
    );
    if (!ok) return;
    setErr("");
    setBusy(true);
    try {
      const res = await invoke<{ transfer_group_id: string; lines: number }>("create_transfer", {
        payload: {
          note: note.trim() || null,
          items: cart.map((l) => ({ barcode: l.barcode, qty: l.qty, from_loc: l.from_loc, to_loc: l.to_loc })),
        },
      });
      await confirm(`✅ Transfer kaydedildi.\nFiş: ${res.transfer_group_id}\nSatır: ${res.lines}`,
        { title: "Transfer Tamam", kind: "info" }
      );
      reset();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const undoLastTransfer = async () => {
    const ok = await confirm("Son transferi geri almak istiyor musun? Stoklar geri dönecek.",
      { title: "Son Transferi Geri Al", kind: "warning" }
    );
    if (!ok) return;
    setErr("");
    setBusy(true);
    try {
      const res = await invoke<{ transfer_group_id: string; restored_lines: number }>("undo_last_transfer", {});
      await confirm(`✅ Geri alındı.\nFiş: ${res.transfer_group_id}\nSatır: ${res.restored_lines}`,
        { title: "Geri Alındı", kind: "info" }
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={P.page}>

      {/* ── Header ── */}
      <div style={P.header}>
        <div>
          <h2 style={P.title}>Ürün Transferi</h2>
          <div style={P.subtitle}>Mağaza ↔ Depo</div>
        </div>
        <button type="button" onClick={undoLastTransfer} disabled={busy} style={P.ghostBtn}>
          ↩ Son transferi geri al
        </button>
      </div>

      {/* ── Scan card ── */}
      <div style={P.card}>
        <div style={P.scanBar}>
          {/* Default from */}
          <label style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
            <span style={P.fieldLabel}>Nereden</span>
            <select
              value={defaultFrom}
              onChange={(e) => setDefaultFrom(e.target.value as Loc)}
              disabled={busy}
              style={P.select}
            >
              <option value="MAGAZA">Mağaza</option>
              <option value="DEPO">Depo</option>
            </select>
          </label>

          {/* Barcode */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={P.fieldLabel}>Barkod</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                ref={inputRef}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addByBarcode(barcode); } }}
                placeholder="Barkod okut…"
                disabled={busy}
                inputMode="numeric"
                autoFocus
                style={P.barcodeInput}
              />
              <button
                type="button"
                onClick={() => addByBarcode(barcode)}
                disabled={busy || !barcode.trim()}
                style={{ ...P.addBtn, opacity: busy || !barcode.trim() ? 0.4 : 1 }}
              >
                Ekle
              </button>
            </div>
          </div>
        </div>

        {/* Note */}
        <div style={{ marginTop: 12 }}>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Not (opsiyonel)"
            disabled={busy}
            style={P.noteInput}
          />
        </div>

        {err && <div style={P.errBox}>{err}</div>}
      </div>

      {/* ── Cart ── */}
      <div style={{ ...P.card, marginTop: 10, padding: 0, overflow: "hidden" }}>
        <div style={P.cartHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: "#111827" }}>Sepet</span>
            {cart.length > 0 && <span style={P.countBadge}>{cart.length}</span>}
          </div>
          {cart.length > 0 && (
            <button type="button" onClick={reset} disabled={busy} style={P.clearBtn}>
              Temizle
            </button>
          )}
        </div>

        {cart.length === 0 ? (
          <div style={P.emptyState}>
            <div style={{ fontSize: 30, opacity: 0.2 }}>📦</div>
            <div style={{ fontWeight: 600, color: "#6b7280", marginTop: 8 }}>Sepet boş</div>
            <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>Barkod okutarak ürün ekleyin</div>
          </div>
        ) : (
          cart.map((l, i) => (
            <div
              key={l.barcode}
              style={{ ...P.cartRow, borderTop: i === 0 ? "none" : "1px solid #f3f4f6" }}
            >
              {/* Product info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={P.itemName}>{l.name}</div>
                <div style={P.itemMeta}>
                  <span style={{ fontFamily: "monospace", fontSize: 11 }}>{l.barcode}</span>
                  {l.color && <span>{l.color}</span>}
                  {l.size  && <span style={P.sizePill}>{l.size}</span>}
                </div>
              </div>

              {/* Controls */}
              <div style={P.controls}>
                {/* Qty */}
                <div style={P.qtyPill}>
                  <button type="button" disabled={busy || l.qty <= 1}
                    onClick={() => updateLine(l.barcode, { qty: l.qty - 1 })}
                    style={{ ...P.qtyBtn, opacity: l.qty <= 1 ? 0.25 : 1 }}
                  >−</button>
                  <span style={P.qtyNum}>{l.qty}</span>
                  <button type="button" disabled={busy}
                    onClick={() => updateLine(l.barcode, { qty: l.qty + 1 })}
                    style={P.qtyBtn}
                  >+</button>
                </div>

                {/* From → To */}
                <div style={P.transferDir}>
                  <select
                    value={l.from_loc}
                    onChange={(e) => updateLine(l.barcode, { from_loc: e.target.value as Loc })}
                    disabled={busy}
                    style={P.dirSelect}
                  >
                    <option value="MAGAZA">Mağaza</option>
                    <option value="DEPO">Depo</option>
                  </select>
                  <span style={{ color: "#9ca3af", fontSize: 13 }}>→</span>
                  <select
                    value={l.to_loc}
                    onChange={(e) => updateLine(l.barcode, { to_loc: e.target.value as Loc })}
                    disabled={busy}
                    style={P.dirSelect}
                  >
                    <option value="DEPO">Depo</option>
                    <option value="MAGAZA">Mağaza</option>
                  </select>
                </div>

                {/* Remove */}
                <button type="button" onClick={() => removeLine(l.barcode)} disabled={busy} style={P.removeBtn}>
                  ✕
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── Footer action ── */}
      {cart.length > 0 && (
        <div style={P.footer}>
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            {cart.length} satır · {cart.reduce((s, l) => s + l.qty, 0)} adet
          </span>
          <button
            type="button"
            onClick={commitTransfer}
            disabled={busy || cart.length === 0}
            style={{ ...P.ctaBtn, opacity: busy || cart.length === 0 ? 0.4 : 1 }}
          >
            Transferi Tamamla
          </button>
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

  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 20,
    flexWrap: "wrap",
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
    flexShrink: 0,
  },

  // scan card
  card: {
    background: "#fff",
    borderRadius: 14,
    padding: 18,
    border: "1px solid #EAE8E5",
  },
  scanBar: {
    display: "flex",
    gap: 12,
    alignItems: "flex-end",
    flexWrap: "wrap",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#9ca3af",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  select: {
    padding: "10px 12px",
    borderRadius: 11,
    border: "1.5px solid #e5e7eb",
    background: "#fafaf9",
    fontSize: 13,
    fontWeight: 700,
    color: "#374151",
    outline: "none",
    cursor: "pointer",
    height: 44,
  },
  barcodeInput: {
    flex: 1,
    padding: "12px 14px",
    borderRadius: 13,
    border: "1.5px solid #e5e7eb",
    fontSize: 20,
    fontWeight: 800,
    outline: "none",
    background: "#fafaf9",
    color: "#111827",
    boxSizing: "border-box",
    minWidth: 0,
  },
  addBtn: {
    padding: "0 22px",
    height: 48,
    borderRadius: 13,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  noteInput: {
    width: "100%",
    padding: "10px 13px",
    borderRadius: 11,
    border: "1.5px solid #e5e7eb",
    fontSize: 13,
    outline: "none",
    background: "#fafaf9",
    color: "#111827",
    boxSizing: "border-box",
  },
  errBox: {
    marginTop: 10,
    padding: "10px 14px",
    borderRadius: 12,
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    fontSize: 13,
    fontWeight: 600,
  },

  // cart
  cartHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 18px",
    borderBottom: "1px solid #f3f4f6",
  },
  countBadge: {
    background: "#111827",
    color: "#fff",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 800,
    padding: "2px 8px",
    lineHeight: "18px",
  },
  clearBtn: {
    padding: "5px 12px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 12,
    fontWeight: 700,
    color: "#6b7280",
    cursor: "pointer",
  },
  emptyState: {
    padding: "44px 20px",
    textAlign: "center",
  },
  cartRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "13px 18px",
    flexWrap: "wrap",
  },
  itemName: {
    fontWeight: 800,
    fontSize: 14,
    color: "#111827",
  },
  itemMeta: {
    display: "flex",
    gap: 6,
    marginTop: 3,
    fontSize: 12,
    color: "#9ca3af",
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

  // controls
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
    flexWrap: "wrap",
  },
  qtyPill: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    background: "#f7f7f5",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "3px 4px",
  },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 17,
    fontWeight: 700,
    color: "#374151",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  qtyNum: {
    minWidth: 22,
    textAlign: "center",
    fontWeight: 900,
    fontSize: 15,
    color: "#111827",
  },
  transferDir: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  dirSelect: {
    padding: "6px 10px",
    borderRadius: 9,
    border: "1.5px solid #e5e7eb",
    background: "#fafaf9",
    fontSize: 12,
    fontWeight: 700,
    color: "#374151",
    outline: "none",
    cursor: "pointer",
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 7,
    border: "1px solid #e5e7eb",
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    color: "#9ca3af",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },

  // footer
  footer: {
    marginTop: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "14px 18px",
    background: "#fff",
    borderRadius: 14,
    border: "1px solid #EAE8E5",
    flexWrap: "wrap",
  },
  ctaBtn: {
    padding: "13px 28px",
    borderRadius: 13,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontSize: 15,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
};
