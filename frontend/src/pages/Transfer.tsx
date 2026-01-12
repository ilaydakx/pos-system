import React, { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";

type Product = {
  barcode: string;
  name: string;
  color?: string | null;
  size?: string | null;

  // transfer için lazım:
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
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [barcode, setBarcode] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [defaultFrom, setDefaultFrom] = useState<Loc>("MAGAZA");
  const [note, setNote] = useState("");

  const [cart, setCart] = useState<CartLine[]>([]);

  

  const linesCount = cart.length;

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
      if (!p) {
        setErr(`❌ Ürün bulunamadı: ${code}`);
        return;
      }

      setCart((prev) => {
        const idx = prev.findIndex((x) => x.barcode === p.barcode);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
          return next;
        }

        const from_loc = defaultFrom;
        const to_loc: Loc = from_loc === "MAGAZA" ? "DEPO" : "MAGAZA";

        return [
          {
            barcode: p.barcode,
            name: p.name,
            color: p.color ?? null,
            size: p.size ?? null,
            qty: 1,
            from_loc,
            to_loc,
          },
          ...prev,
        ];
      });

      setBarcode("");
      setTimeout(() => inputRef.current?.focus(), 10);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onBarcodeKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addByBarcode(barcode);
    }
  };

  const updateLine = (barcode: string, patch: Partial<CartLine>) => {
    setCart((prev) =>
      prev.map((l) => {
        if (l.barcode !== barcode) return l;
        const next: CartLine = { ...l, ...patch };

        next.qty = Math.max(1, Number(next.qty ?? 1));

        if (next.from_loc === next.to_loc) {
          next.to_loc = next.from_loc === "MAGAZA" ? "DEPO" : "MAGAZA";
        }

        return next;
      })
    );
  };

  const removeLine = (barcode: string) => {
    setCart((prev) => prev.filter((l) => l.barcode !== barcode));
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const commitTransfer = async () => {
    if (cart.length === 0) {
      setErr("❌ Sepet boş.");
      return;
    }

    const ok = await confirm(
      `Transferi kaydetmek istiyor musun?\nSatır: ${cart.length}`,
      { title: "Transfer Onayı", kind: "warning" }
    );
    if (!ok) return;

    setErr("");
    setBusy(true);
    try {
      const res = await invoke<{ transfer_group_id: string; lines: number }>(
        "create_transfer",
        {
          payload: {
            note: note.trim() ? note.trim() : null,
            items: cart.map((l) => ({
              barcode: l.barcode,
              qty: l.qty,
              from_loc: l.from_loc,
              to_loc: l.to_loc,
            })),
          },
        }
      );

      await confirm(
        `✅ Transfer kaydedildi.\nFiş: ${res.transfer_group_id}\nSatır: ${res.lines}`,
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
    const ok = await confirm(
      "Son transferi geri almak istiyor musun? (stoklar geri dönecek)",
      { title: "Son Transferi Geri Al", kind: "warning" }
    );
    if (!ok) return;

    setErr("");
    setBusy(true);
    try {
      const res = await invoke<{ transfer_group_id: string; restored_lines: number }>(
        "undo_last_transfer",
        {}
      );

      await confirm(
        `✅ Geri alındı.\nFiş: ${res.transfer_group_id}\nSatır: ${res.restored_lines}`,
        { title: "Geri Alındı", kind: "info" }
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Transfer (Mağaza ↔ Depo)</h2>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={undoLastTransfer} disabled={busy}>
            ↩ Son transferi geri al
          </button>
          <button onClick={reset} disabled={busy}>
            Sepeti temizle
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 12, alignItems: "center" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Nereden</div>
          <select
            value={defaultFrom}
            onChange={(e) => setDefaultFrom(e.target.value as Loc)}
            disabled={busy}
            style={{ padding: 8 }}
          >
            <option value="MAGAZA">Mağaza</option>
            <option value="DEPO">Depo</option>
          </select>
        </label>

        <label style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Barkod</div>
          <input
            ref={inputRef}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={onBarcodeKeyDown}
            placeholder="Barkodu okut ve Enter"
            disabled={busy}
            style={{ padding: 10, fontSize: 16 }}
          />
        </label>

        <button
          onClick={() => addByBarcode(barcode)}
          disabled={busy || !barcode.trim()}
          style={{ height: 44 }}
        >
          Ekle
        </button>
      </div>

      <div style={{ marginTop: 10 }}>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Not (opsiyonel)"
          disabled={busy}
          style={{ width: "100%", padding: 10 }}
        />
      </div>

      {err && (
        <div style={{ marginTop: 10, color: "crimson", whiteSpace: "pre-wrap" }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 12, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
          <thead>
            <tr>
              {["Ürün", "Adet", "Nereden", "Nereye", ""].map((h) => (
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
            {cart.map((l) => (
              <tr key={l.barcode}>
                <td style={cellStrong}>
                  {l.name}
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {l.barcode}
                    {l.color ? ` • ${l.color}` : ""}
                    {l.size ? ` • ${l.size}` : ""}
                  </div>
                </td>

                <td style={cell}>
                  <input
                    value={l.qty}
                    onChange={(e) => updateLine(l.barcode, { qty: Number(e.target.value) || 1 })}
                    disabled={busy}
                    style={{ width: 80, padding: 6 }}
                  />
                </td>

                <td style={cell}>
                  <select
                    value={l.from_loc}
                    onChange={(e) => updateLine(l.barcode, { from_loc: e.target.value as Loc })}
                    disabled={busy}
                    style={{ padding: 6 }}
                  >
                    <option value="MAGAZA">Mağaza</option>
                    <option value="DEPO">Depo</option>
                  </select>
                </td>

                <td style={cell}>
                  <select
                    value={l.to_loc}
                    onChange={(e) => updateLine(l.barcode, { to_loc: e.target.value as Loc })}
                    disabled={busy}
                    style={{ padding: 6 }}
                  >
                    <option value="DEPO">Depo</option>
                    <option value="MAGAZA">Mağaza</option>
                  </select>
                </td>

                <td style={cell}>
                  <button onClick={() => removeLine(l.barcode)} disabled={busy}>
                    🗑
                  </button>
                </td>
              </tr>
            ))}

            {cart.length === 0 && (
              <tr>
                <td style={{ padding: 12, opacity: 0.7 }} colSpan={5}>
                  Sepet boş. Barkod okut.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ opacity: 0.8 }}>Satır: {linesCount}</div>

        <button
          onClick={commitTransfer}
          disabled={busy || cart.length === 0}
          style={{ marginLeft: "auto", padding: 12, fontSize: 16 }}
        >
          Transferi Tamamla
        </button>
      </div>
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f0f0f0",
  verticalAlign: "top",
};

const cellStrong: React.CSSProperties = {
  ...cell,
  fontWeight: 700,
};