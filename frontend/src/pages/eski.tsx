

import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useWindowWidth } from "../hooks/useWindowWidth";

// Tüm ürünlerin tutulduğu store (Sales mount olduğunda bir kez yüklenir)
let _allProductsCache: Product[] | null = null;

type Product = {
  barcode: string;
  product_code?: string | null;
  category?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  buy_price: number;
  sell_price: number;
  stock: number;
  magaza_stok?: number | null;
  depo_stok?: number | null;
};

type SoldFrom = "MAGAZA" | "DEPO";


type PaymentMethod = "CARD" | "CASH";

function stockFor(p: Product, loc: SoldFrom): number {
  const v = loc === "MAGAZA" ? p.magaza_stok : p.depo_stok;
  const n = typeof v === "number" ? v : p.stock;
  return Number.isFinite(n) ? n : 0;
}

type CartLine = {
  barcode: string;
  name: string;
  color?: string | null;
  size?: string | null;
  qty: number;
  list_price: number;
  discount_enabled: boolean;
  discount_type: "TL" | "PCT";
  discount_amount: number;
  unit_price: number;
  sold_from: SoldFrom;
};

type CreateSaleResult = {
  sale_group_id: string;
  total: number;
  lines: number;
};

export function Sales() {
  const windowWidth = useWindowWidth();
  const isNarrow = windowWidth < 860;

  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const [barcode, setBarcode] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [soldFrom, setSoldFrom] = useState<SoldFrom>("MAGAZA");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CARD");
  const [cart, setCart] = useState<CartLine[]>([]);

  // Ürün arama state'leri
  const [allProducts, setAllProducts] = useState<Product[]>(_allProductsCache ?? []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
    // Ürün listesini yükle (cache varsa tekrar yüklemez)
    if (!_allProductsCache) {
      invoke<Product[]>("list_products").then((rows) => {
        _allProductsCache = rows ?? [];
        setAllProducts(_allProductsCache);
      }).catch(() => {});
    }
  }, []);

  // Arama sonuçları
  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return [];
    return allProducts
      .filter((p) => {
        const stock = stockFor(p, soldFrom);
        if (stock <= 0) return false;
        return [p.barcode, p.product_code ?? "", p.name, p.color ?? "", p.size ?? "", p.category ?? ""]
          .join(" ").toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [searchQ, allProducts, soldFrom]);

  // Dışarı tıklayınca kapat
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
        setSearchQ("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [searchOpen]);

  const total = useMemo(
    () => cart.reduce((sum, l) => sum + l.qty * l.unit_price, 0),
    [cart]
  );

  const resetSale = () => {
    setCart([]);
    setBarcode("");
    setErr("");
    setSearchOpen(false);
    setSearchQ("");
    setPaymentMethod("CARD");
    // Satış sonrası stok değiştiği için cache'i sıfırla
    _allProductsCache = null;
    invoke<Product[]>("list_products").then((rows) => {
      _allProductsCache = rows ?? [];
      setAllProducts(_allProductsCache);
    }).catch(() => {});
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
          const cur = next[idx];
          const nextQty = cur.qty + 1;
          const s = stockFor(p, cur.sold_from);
          if (nextQty > s) {
            setErr(`❌ Yetersiz stok: ${p.name} (stok: ${s})`);
            return prev;
          }
          next[idx] = { ...cur, qty: nextQty };
          return next;
        }

        const list_price = Number(p.sell_price ?? 0);
        const s0 = stockFor(p, soldFrom);
        if (1 > s0) {
          setErr(`❌ Stok yok: ${p.name} (stok: ${s0})`);
          return prev;
        }

        const line: CartLine = {
          barcode: p.barcode,
          name: p.name,
          color: p.color ?? null,
          size: p.size ?? null,
          qty: 1,
          list_price,
          discount_enabled: false,
          discount_type: "TL",
          discount_amount: 0,
          unit_price: list_price,
          sold_from: soldFrom,
        };

        return [line, ...prev];
      });

      setBarcode("");
      setTimeout(() => inputRef.current?.focus(), 10);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const addByProduct = (p: Product) => {
    setSearchOpen(false);
    setSearchQ("");
    setErr("");

    setCart((prev) => {
      const idx = prev.findIndex((x) => x.barcode === p.barcode);
      if (idx >= 0) {
        const next = [...prev];
        const cur = next[idx];
        const nextQty = cur.qty + 1;
        const s = stockFor(p, cur.sold_from);
        if (nextQty > s) {
          setErr(`❌ Yetersiz stok: ${p.name} (stok: ${s})`);
          return prev;
        }
        next[idx] = { ...cur, qty: nextQty };
        return next;
      }

      const list_price = Number(p.sell_price ?? 0);
      const s0 = stockFor(p, soldFrom);
      if (s0 <= 0) {
        setErr(`❌ Stok yok: ${p.name} (stok: ${s0})`);
        return prev;
      }

      return [{
        barcode: p.barcode,
        name: p.name,
        color: p.color ?? null,
        size: p.size ?? null,
        qty: 1,
        list_price,
        discount_enabled: false,
        discount_type: "TL",
        discount_amount: 0,
        unit_price: list_price,
        sold_from: soldFrom,
      }, ...prev];
    });

    setTimeout(() => inputRef.current?.focus(), 10);
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

        if (!next.discount_enabled) {
          next.discount_amount = 0;
          next.discount_type = "TL";
          next.unit_price = next.list_price;
        } else {
          const d = Math.max(0, Number(next.discount_amount ?? 0));
          next.discount_amount = d;
          if (next.discount_type === "PCT") {
            const pct = Math.min(100, d);
            next.unit_price = Math.max(0, next.list_price * (1 - pct / 100));
          } else {
            next.unit_price = Math.max(0, next.list_price - d);
          }
        }

        next.qty = Math.max(1, Number(next.qty ?? 1));
        return next;
      })
    );
  };

  const removeLine = (barcode: string) => {
    setCart((prev) => prev.filter((l) => l.barcode !== barcode));
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const commitSale = async () => {
    try {
      if (cart.length === 0) {
        setErr("❌ Sepet boş.");
        alert("❌ Sepet boş.");
        return;
      }

      const msg =
        `Satışı kaydetmek istiyor musun?\n` +
        `Ödeme: ${paymentMethod === "CARD" ? "Kart" : "Nakit"}\n` +
        `Toplam: ${fmtMoney(total)}`;

      const ok = await confirm(msg, {
        title: "Satış Onayı",
        kind: "warning",
      });

      if (!ok) return;

      setErr("");
      setBusy(true);

      const payload = {
        sold_from_default: soldFrom,
        payment_method: paymentMethod,
        items: cart.map((l) => ({
          barcode: l.barcode,
          qty: l.qty,
          list_price: l.list_price,
          discount_amount: l.discount_enabled ? l.list_price - l.unit_price : 0,
          unit_price: l.unit_price,
          sold_from: l.sold_from,
        })),
      };


      const res = await invoke<CreateSaleResult>("create_sale", { payload });


      await confirm(
        `✅ Satış kaydedildi.\nFiş No: ${res.sale_group_id}\nÖdeme: ${
          paymentMethod === "CARD" ? "Kart" : "Nakit"
        }\nToplam: ${fmtMoney(res.total)}`,
        { title: "Satış Tamam", kind: "info" }
      );

      resetSale();
    } catch (e) {
      // hata mesajını kullanıcıya göster
      const msg = String(e);
      setErr(msg);
      alert("❌ create_sale HATA:\n" + msg);
    } finally {
      setBusy(false);
    }
  };

  const undoLastSale = async () => {
    const ok = await confirm(
      "Son satışı geri almak istiyor musun? (Stok geri eklenecek)",
      {
        title: "Son Satışı Geri Al",
        kind: "warning",
      }
    );
    if (!ok) return;

    setErr("");
    setBusy(true);
    try {
      const res = await invoke<{ sale_group_id: string; restored_lines: number }>(
        "undo_last_sale",
        {}
      );
      await confirm(
        `✅ Geri alındı.\nFiş No: ${res.sale_group_id}\nSatır: ${res.restored_lines}`,
        {
          title: "Geri Alındı",
          kind: "info",
        }
      );
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={ui.page}>
      {/* Header */}
      <div style={ui.header}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h1 style={ui.h1}>Satış</h1>
        </div>

        <div style={ui.headerActions}>
          <button type="button" onClick={undoLastSale} disabled={busy} style={ui.btnGhost}>
            ↩ Son satışı geri al
          </button>
          <button type="button" onClick={resetSale} disabled={busy} style={ui.btnGhost}>
            Sepeti temizle
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ ...ui.grid, gridTemplateColumns: isNarrow ? "1fr" : "minmax(0,1fr) 320px" }}>
        {/* Left: Input + Cart */}
        <div style={ui.leftCol}>
          <div style={ui.card}>
            <div style={ui.cardHeaderRow}>
              <div>
                <div style={ui.cardTitle}>Barkod okut</div>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
                  <span style={ui.label}>Satış yeri</span>
                  <select
                    value={soldFrom}
                    onChange={(e) => setSoldFrom(e.target.value as SoldFrom)}
                    disabled={busy}
                    style={ui.select}
                  >
                    <option value="MAGAZA">Mağaza</option>
                    <option value="DEPO">Depo</option>
                  </select>
                </label>

                <button
                  type="button"
                  onClick={() => {
                    setSearchOpen((v) => !v);
                    setSearchQ("");
                    setTimeout(() => searchInputRef.current?.focus(), 60);
                  }}
                  disabled={busy}
                  style={{ ...ui.btnGhost, height: 40, whiteSpace: "nowrap" }}
                >
                  🔍 Ürün Ara
                </button>
              </div>
            </div>

            {/* Ürün arama paneli */}
            {searchOpen && (
              <div ref={searchBoxRef} style={{ marginTop: 10, position: "relative" }}>
                <input
                  ref={searchInputRef}
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Ürün adı, barkod, renk, beden…"
                  style={{ ...ui.input, width: "100%", fontSize: 15, boxSizing: "border-box" as const }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setSearchOpen(false); setSearchQ(""); }
                    if (e.key === "Enter" && searchResults.length === 1) addByProduct(searchResults[0]);
                  }}
                />
                {searchQ.trim() && (
                  <div style={{
                    position: "absolute",
                    top: "calc(100% + 4px)",
                    left: 0,
                    right: 0,
                    background: "white",
                    border: "1px solid rgba(17,24,39,0.12)",
                    borderRadius: 14,
                    boxShadow: "0 12px 32px rgba(17,24,39,0.14)",
                    zIndex: 100,
                    maxHeight: 340,
                    overflow: "auto",
                  }}>
                    {searchResults.length === 0 ? (
                      <div style={{ padding: "14px 16px", opacity: 0.65 }}>Sonuç yok.</div>
                    ) : (
                      searchResults.map((p) => {
                        const stock = stockFor(p, soldFrom);
                        return (
                          <div
                            key={p.barcode}
                            onClick={() => addByProduct(p)}
                            style={{
                              padding: "10px 16px",
                              cursor: "pointer",
                              borderBottom: "1px solid rgba(17,24,39,0.06)",
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              gap: 12,
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#f9fafb")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
                          >
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                              <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>
                                {p.barcode}
                                {p.color ? ` • ${p.color}` : ""}
                                {p.size ? ` • ${p.size}` : ""}
                                {p.category ? ` • ${p.category}` : ""}
                              </div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontWeight: 800, fontSize: 14 }}>{fmtMoney(p.sell_price)}</div>
                              <div style={{ fontSize: 12, opacity: stock > 0 ? 0.65 : 1, color: stock > 0 ? undefined : "#b91c1c", marginTop: 2 }}>
                                Stok: {stock}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            )}

            <div style={ui.barcodeRow}>
              <div style={{ flex: 1 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span style={ui.label}>Barkod</span>
                  <input
                    ref={inputRef}
                    value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyDown={onBarcodeKeyDown}
                    placeholder="1000001"
                    disabled={busy}
                    style={ui.input}
                    inputMode="numeric"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => addByBarcode(barcode)}
                disabled={busy || !barcode.trim()}
                style={{ ...ui.btnPrimary, opacity: busy || !barcode.trim() ? 0.6 : 1 }}
              >
                Ekle
              </button>
            </div>

            {err && <div style={ui.errBox}>{err}</div>}
          </div>

          <div style={{ height: 12 }} />

          {/* Cart */}
          <div style={ui.card}>
            <div style={ui.cardHeaderRow}>
              <div>
                <div style={ui.cardTitle}>Sepet</div>
              </div>

              <div style={ui.badges}>
                <span style={ui.badge}>Satır: <b>{cart.length}</b></span>
                <span style={ui.badge}>Toplam: <b>{fmtMoney(total)}</b></span>
              </div>
            </div>

            <div style={{ overflowX: "auto", marginTop: 10 }}>
              <table style={ui.table}>
                <thead>
                  <tr>
                    {[
                      "Ürün",
                      "Adet",
                      "Yer",
                      "Fiyat",
                      "İndirim",
                      "Satır Toplam",
                      "",
                    ].map((h) => (
                      <th key={h} style={ui.th}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cart.map((l) => (
                    <tr key={l.barcode}>
                      <td style={ui.tdStrong}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div>{l.name}</div>
                          <div style={ui.muted}>
                            {l.barcode}
                            {l.color ? ` • ${l.color}` : ""}
                            {l.size ? ` • ${l.size}` : ""}
                          </div>
                        </div>
                      </td>

                      <td style={ui.td}>
                        <input
                          type="number"
                          min={1}
                          value={l.qty}
                          onChange={(e) => updateLine(l.barcode, { qty: Number(e.target.value) || 1 })}
                          disabled={busy}
                          style={ui.qtyInput}
                        />
                      </td>

                      <td style={ui.td}>
                        <select
                          value={l.sold_from}
                          onChange={(e) => updateLine(l.barcode, { sold_from: e.target.value as SoldFrom })}
                          disabled={busy}
                          style={ui.selectSmall}
                        >
                          <option value="MAGAZA">Mağaza</option>
                          <option value="DEPO">Depo</option>
                        </select>
                      </td>

                      <td style={ui.td}>
                        <div style={ui.muted}>Liste</div>
                        <div style={{ fontWeight: 700 }}>{fmtMoney(l.list_price)}</div>
                        <div style={{ height: 6 }} />
                        <div style={ui.muted}>Birim</div>
                        <div style={{ fontWeight: 700 }}>{fmtMoney(l.unit_price)}</div>
                      </td>

                      <td style={ui.td}>
                        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={l.discount_enabled}
                            onChange={(e) => updateLine(l.barcode, { discount_enabled: e.target.checked })}
                            disabled={busy}
                          />
                          <span style={{ fontWeight: 700 }}>İndirim</span>
                        </label>

                        {l.discount_enabled && (
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                            {/* % / ₺ toggle */}
                            <div style={{ display: "flex", borderRadius: 8, border: "1px solid rgba(17,24,39,0.15)", overflow: "hidden", width: "fit-content" }}>
                              {(["TL", "PCT"] as const).map((t) => (
                                <button
                                  key={t}
                                  type="button"
                                  disabled={busy}
                                  onClick={() => updateLine(l.barcode, { discount_type: t, discount_amount: 0 })}
                                  style={{
                                    padding: "4px 10px", border: "none", cursor: "pointer", fontSize: 12, fontWeight: 800,
                                    background: l.discount_type === t ? "#111827" : "#fff",
                                    color: l.discount_type === t ? "#fff" : "#111827",
                                  }}
                                >
                                  {t === "TL" ? "₺" : "%"}
                                </button>
                              ))}
                            </div>

                            {/* input */}
                            <input
                              value={l.discount_amount === 0 ? "" : l.discount_amount}
                              placeholder={l.discount_type === "PCT" ? "%" : "₺"}
                              onChange={(e) => updateLine(l.barcode, { discount_amount: Number(e.target.value) || 0 })}
                              disabled={busy}
                              inputMode="decimal"
                              style={{ ...ui.moneyInput, width: 70 }}
                            />

                            {/* shortcut buttons */}
                            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                              {(l.discount_type === "PCT" ? [5, 10, 20] : [10, 20, 50]).map((v) => (
                                <button
                                  key={v}
                                  type="button"
                                  disabled={busy}
                                  onClick={() => updateLine(l.barcode, { discount_amount: v })}
                                  style={{
                                    padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(17,24,39,0.15)",
                                    background: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700,
                                  }}
                                >
                                  {l.discount_type === "PCT" ? `%${v}` : `${v}₺`}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </td>

                      <td style={ui.tdStrong}>{fmtMoney(l.qty * l.unit_price)}</td>

                      <td style={ui.td}>
                        <button type="button" onClick={() => removeLine(l.barcode)} disabled={busy} style={ui.trashBtn}>
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))}

                  {cart.length === 0 && (
                    <tr>
                      <td style={{ padding: 14, opacity: 0.7 }} colSpan={7}>
                        Sepet boş. Barkod okut.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: Summary */}
        <div style={ui.rightCol}>
          <div style={isNarrow ? {} : ui.sticky}>
            <div style={ui.card}>
              <div style={ui.cardTitle}>Ödeme</div>
              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>Satışı tamamlamadan önce ödeme tipini seç.</div>

              <div style={{ height: 12 }} />

              <div style={ui.totalBox}>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Toplam ödenecek</div>
                <div style={ui.total}>{fmtMoney(total)}</div>
              </div>

              <div style={{ height: 12 }} />

              <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>Ödeme tipi</div>
              <div style={ui.segment}>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("CARD")}
                  disabled={busy}
                  style={paymentMethod === "CARD" ? ui.segmentOn : ui.segmentOff}
                >
                  Kart
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("CASH")}
                  disabled={busy}
                  style={paymentMethod === "CASH" ? ui.segmentOn : ui.segmentOff}
                >
                  Nakit
                </button>
              </div>

              <button
                type="button"
                onClick={commitSale}
                disabled={busy || cart.length === 0}
                style={{ ...ui.btnBig, opacity: busy || cart.length === 0 ? 0.6 : 1 }}
              >
                Satışı Tamamla
              </button>

              <div style={ui.tips}>
                • Satış kaydedilene kadar yeni ürün okutabilirsin.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


const ui: Record<string, React.CSSProperties> = {
  page: {
    padding: 18,
    fontFamily: "system-ui",
    background: "#fbf6f3",
    minHeight: "100%",
    boxSizing: "border-box" as const,
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  h1: { margin: 0, fontSize: 26, fontWeight: 900, color: "#111827" },
  sub: { fontSize: 12, opacity: 0.65 },
  headerActions: { display: "flex", gap: 8, alignItems: "center" },

  grid: {
    display: "grid",
    gap: 14,
    alignItems: "start",
  },
  leftCol: { minWidth: 0, overflow: "hidden" },
  rightCol: { minWidth: 0 },
  sticky: { position: "sticky", top: 12 },

  card: {
    background: "#ffffff",
    border: "1px solid rgba(17,24,39,0.10)",
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 10px 24px rgba(17,24,39,0.06)",
  },
  cardHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  cardTitle: { fontWeight: 900, fontSize: 15, color: "#111827" },
  cardHint: { fontSize: 12, opacity: 0.7, marginTop: 4 },

  label: { fontSize: 12, opacity: 0.75, fontWeight: 700 },
  select: {
    padding: "10px 10px",
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    background: "#fff",
    color: "#111827",
    fontWeight: 700,
    height: 40,
    lineHeight: "24px",
  },
  selectSmall: {
    padding: "6px 10px",
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    background: "#fff",
    color: "#111827",
    fontWeight: 800,
    minWidth: 110,
    height: 36,
    lineHeight: "24px",
  },
  input: {
    padding: "12px 12px",
    borderRadius: 14,
    border: "1px solid rgba(17,24,39,0.18)",
    fontSize: 18,
    fontWeight: 800,
    outline: "none",
  },
  barcodeRow: { display: "flex", gap: 10, alignItems: "end", marginTop: 10 },

  btnGhost: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.12)",
    background: "rgba(255,255,255,0.9)",
    cursor: "pointer",
    fontWeight: 800,
  },
  btnPrimary: {
    height: 48,
    padding: "0 14px",
    borderRadius: 14,
    border: "1px solid rgba(17,24,39,0.15)",
    background: "#111827",
    color: "#fff",
    cursor: "pointer",
    fontWeight: 900,
  },
  btnBig: {
    marginTop: 12,
    width: "100%",
    padding: "14px 12px",
    borderRadius: 14,
    border: "1px solid rgba(17,24,39,0.15)",
    background: "#111827",
    color: "#fff",
    cursor: "pointer",
    fontSize: 16,
    fontWeight: 900,
  },

  errBox: {
    marginTop: 10,
    color: "#b91c1c",
    whiteSpace: "pre-wrap",
    padding: 10,
    borderRadius: 12,
    background: "rgba(185,28,28,0.08)",
    border: "1px solid rgba(185,28,28,0.18)",
    fontWeight: 700,
  },

  badges: { display: "flex", gap: 8, flexWrap: "wrap" },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(17,24,39,0.12)",
    background: "#fafafa",
    fontSize: 12,
  },

  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: 920,
  },
  th: {
    textAlign: "left",
    borderBottom: "1px solid rgba(17,24,39,0.12)",
    padding: "10px 10px",
    position: "sticky",
    top: 0,
    background: "#fff",
    fontSize: 12,
    letterSpacing: 0.2,
    opacity: 0.75,
  },
  td: {
    padding: "12px 10px",
    borderBottom: "1px solid rgba(17,24,39,0.06)",
    verticalAlign: "middle",
  },
  tdStrong: {
    padding: "12px 10px",
    borderBottom: "1px solid rgba(17,24,39,0.06)",
    verticalAlign: "middle",
    fontWeight: 900,
  },
  muted: { fontSize: 12, opacity: 0.7 },

  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 900,
  },
  qtyInput: {
    width: 36,
    height: 15,
    padding: "6px 8px",
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    fontWeight: 900,
    textAlign: "center" as const,
  },
  moneyInput: {
    width: 55,
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    fontWeight: 900,
  },
  trashBtn: {
    width: 40,
    height: 36,
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.12)",
    background: "#fff",
    cursor: "pointer",
  },

  totalBox: {
    padding: 12,
    borderRadius: 16,
    border: "1px solid rgba(17,24,39,0.10)",
    background: "linear-gradient(135deg, #fde68a, #fbcfe8)",
  },
  total: { fontSize: 34, fontWeight: 950, marginTop: 4, color: "#111827" },

  segment: {
    display: "flex",
    gap: 8,
  },
  segmentOn: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    cursor: "pointer",
    fontWeight: 900,
    background: "#111827",
    color: "#fff",
  },
  segmentOff: {
    flex: 1,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    cursor: "pointer",
    fontWeight: 900,
    background: "#fff",
    color: "#111827",
  },

  tips: { marginTop: 10, fontSize: 12, opacity: 0.75, lineHeight: 1.5 },
};

function fmtMoney(v: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(v ?? 0);
}