import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { useWindowWidth } from "../hooks/useWindowWidth";

let _allProductsCache: Product[] | null = null;
// Arama listesi bu süreden eski ise yeniden yüklenir (milisaniye).
const PRODUCT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 dakika
let _allProductsCacheAt = 0;

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

function fmtMoney(v: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(v ?? 0);
}

export function Sales() {
  const windowWidth = useWindowWidth();
  const isNarrow = windowWidth < 860;

  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [barcode, setBarcode] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("CARD");
  const [cart, setCart] = useState<CartLine[]>([]);

  const [allProducts, setAllProducts] = useState<Product[]>(_allProductsCache ?? []);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchBoxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
    const stale = !_allProductsCache || Date.now() - _allProductsCacheAt > PRODUCT_CACHE_TTL_MS;
    if (stale) {
      invoke<Product[]>("list_products").then((rows) => {
        _allProductsCache = rows ?? [];
        _allProductsCacheAt = Date.now();
        setAllProducts(_allProductsCache);
      }).catch(() => {});
    }
  }, []);

  const searchResults = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!q) return [];
    return allProducts
      .filter((p) => {
        // Herhangi bir lokasyonda stok varsa göster
        const total = (typeof p.magaza_stok === "number" ? p.magaza_stok : 0)
                    + (typeof p.depo_stok   === "number" ? p.depo_stok   : p.stock ?? 0);
        if (total <= 0) return false;
        return [p.barcode, p.product_code ?? "", p.name, p.color ?? "", p.size ?? "", p.category ?? ""]
          .join(" ").toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [searchQ, allProducts]);

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
    _allProductsCache = null;
    _allProductsCacheAt = 0;
    invoke<Product[]>("list_products").then((rows) => {
      _allProductsCache = rows ?? [];
      _allProductsCacheAt = Date.now();
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
      if (!p) { setErr(`❌ Ürün bulunamadı: ${code}`); return; }

      // Lokasyonu otomatik belirle: barkod unique olduğu için stok bakiyesine göre seç
      const mStock = typeof p.magaza_stok === "number" ? p.magaza_stok : 0;
      const dStock = typeof p.depo_stok   === "number" ? p.depo_stok   : 0;
      const autoLoc: SoldFrom = dStock > 0 && mStock <= 0 ? "DEPO" : "MAGAZA";

      // Stok kontrolü setCart updater'ı dışında yapılır.
      // setCart pure bir fonksiyon almalı; içinde setErr çağırmak Strict Mode'da
      // çift tetiklenmeye ve tutarsız state sırasına yol açar.
      const existing = cart.find((x) => x.barcode === p.barcode);
      if (existing) {
        const s = stockFor(p, existing.sold_from);
        if (existing.qty + 1 > s) {
          setErr(`❌ Yetersiz stok: ${p.name} (stok: ${s})`);
          return;
        }
      } else {
        const s0 = stockFor(p, autoLoc);
        if (s0 < 1) {
          setErr(`❌ Stok yok: ${p.name}`);
          return;
        }
      }

      setCart((prev) => {
        const idx = prev.findIndex((x) => x.barcode === p.barcode);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
          return next;
        }
        const list_price = Number(p.sell_price ?? 0);
        return [{ barcode: p.barcode, name: p.name, color: p.color ?? null, size: p.size ?? null,
          qty: 1, list_price, discount_enabled: false, discount_type: "TL", discount_amount: 0,
          unit_price: list_price, sold_from: autoLoc }, ...prev];
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

    // Stok kontrolü setCart dışında — aynı neden: updater pure olmalı.
    const mStock = typeof p.magaza_stok === "number" ? p.magaza_stok : 0;
    const dStock = typeof p.depo_stok   === "number" ? p.depo_stok   : 0;
    const autoLoc: SoldFrom = dStock > 0 && mStock <= 0 ? "DEPO" : "MAGAZA";

    const existing = cart.find((x) => x.barcode === p.barcode);
    if (existing) {
      const s = stockFor(p, existing.sold_from);
      if (existing.qty + 1 > s) {
        setErr(`❌ Yetersiz stok: ${p.name}`);
        return;
      }
    } else {
      const s0 = stockFor(p, autoLoc);
      if (s0 <= 0) {
        setErr(`❌ Stok yok: ${p.name}`);
        return;
      }
    }

    setCart((prev) => {
      const idx = prev.findIndex((x) => x.barcode === p.barcode);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      const list_price = Number(p.sell_price ?? 0);
      return [{ barcode: p.barcode, name: p.name, color: p.color ?? null, size: p.size ?? null,
        qty: 1, list_price, discount_enabled: false, discount_type: "TL", discount_amount: 0,
        unit_price: list_price, sold_from: autoLoc }, ...prev];
    });
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const updateLine = (bc: string, patch: Partial<CartLine>) => {
    setCart((prev) =>
      prev.map((l) => {
        if (l.barcode !== bc) return l;
        const next: CartLine = { ...l, ...patch };
        if (!next.discount_enabled) {
          next.discount_amount = 0;
          next.discount_type = "TL";
          next.unit_price = next.list_price;
        } else {
          const d = Math.max(0, Number(next.discount_amount ?? 0));
          next.discount_amount = d;
          if (next.discount_type === "PCT") {
            next.unit_price = Math.max(0, next.list_price * (1 - Math.min(100, d) / 100));
          } else {
            next.unit_price = Math.max(0, next.list_price - d);
          }
        }
        next.qty = Math.max(1, Number(next.qty ?? 1));
        return next;
      })
    );
  };

  const removeLine = (bc: string) => {
    setCart((prev) => prev.filter((l) => l.barcode !== bc));
    setTimeout(() => inputRef.current?.focus(), 10);
  };

  const commitSale = async () => {
    try {
      if (cart.length === 0) { setErr("❌ Sepet boş."); alert("❌ Sepet boş."); return; }
      const ok = await confirm(
        `Satışı kaydetmek istiyor musun?\nÖdeme: ${paymentMethod === "CARD" ? "Kart" : "Nakit"}\nToplam: ${fmtMoney(total)}`,
        { title: "Satış Onayı", kind: "warning" }
      );
      if (!ok) return;
      setErr("");
      setBusy(true);
      const payload = {
        sold_from_default: "MAGAZA",
        payment_method: paymentMethod,
        items: cart.map((l) => ({
          barcode: l.barcode, qty: l.qty, list_price: l.list_price,
          discount_amount: l.discount_enabled ? l.list_price - l.unit_price : 0,
          unit_price: l.unit_price, sold_from: l.sold_from,
        })),
      };
      const res = await invoke<CreateSaleResult>("create_sale", { payload });
      await message(
        `Fiş No: ${res.sale_group_id}\nÖdeme: ${paymentMethod === "CARD" ? "Kart" : "Nakit"}\nToplam: ${fmtMoney(res.total)}`,
        { title: "Satış Kaydedildi", kind: "info" }
      );
      resetSale();
    } catch (e) {
      const msg = String(e);
      setErr(msg);
      alert("❌ create_sale HATA:\n" + msg);
    } finally {
      setBusy(false);
    }
  };

  const undoLastSale = async () => {
    // Backend yalnızca son 30 dakika içindeki satışları geri alır.
    const ok = await confirm(
      "Son satışı geri almak istiyor musun?\n\nNot: Yalnızca son 30 dakika içindeki satışlar geri alınabilir. Stok iade edilir, kayıt silinmez.",
      { title: "Son Satışı Geri Al", kind: "warning" }
    );
    if (!ok) return;
    setErr("");
    setBusy(true);
    try {
      const res = await invoke<{ sale_group_id: string; restored_lines: number; sold_at: string }>("undo_last_sale", {});
      const saleTime = res.sold_at.replace("T", " ").slice(0, 16);
      await message(
        `Geri alındı.\nFiş No: ${res.sale_group_id}\nSatış saati: ${saleTime}\nSatır: ${res.restored_lines}`,
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
      <div style={{ ...P.grid, gridTemplateColumns: isNarrow ? "1fr" : "minmax(0,1fr) 300px" }}>

        {/* ── LEFT COLUMN ── */}
        <div style={P.leftCol}>

          {/* ── Scan card ── */}
          <div style={P.card}>

            {/* Top bar: title + location + search */}
            <div style={P.scanBar}>
              <span style={P.scanLabel}>Satış</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setSearchOpen((v) => !v); setSearchQ(""); setTimeout(() => searchInputRef.current?.focus(), 60); }}
                style={P.searchBtn}
              >
                Ara
              </button>
            </div>

            {/* Search panel */}
            {searchOpen && (
              <div ref={searchBoxRef} style={{ position: "relative", marginTop: 10 }}>
                <input
                  ref={searchInputRef}
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Ürün adı, barkod, renk, beden…"
                  style={{ ...P.barcodeInput, fontSize: 15, padding: "12px 14px" }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") { setSearchOpen(false); setSearchQ(""); }
                    if (e.key === "Enter" && searchResults.length === 1) addByProduct(searchResults[0]);
                  }}
                />
                {searchQ.trim() && (
                  <div style={P.searchDrop}>
                    {searchResults.length === 0
                      ? <div style={{ padding: "12px 16px", opacity: 0.5, fontSize: 14 }}>Sonuç yok.</div>
                      : searchResults.map((p) => {
                        const mS = typeof p.magaza_stok === "number" ? p.magaza_stok : 0;
                        const dS = typeof p.depo_stok   === "number" ? p.depo_stok   : 0;
                        const stock = mS + dS || p.stock || 0;
                        return (
                          <div key={p.barcode} onClick={() => addByProduct(p)} style={P.searchItem}
                            onMouseEnter={(e) => (e.currentTarget.style.background = "#f7f7f5")}
                            onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                          >
                            <div>
                              <div style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>{p.name}</div>
                              <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 2 }}>
                                {p.barcode}{p.color ? ` · ${p.color}` : ""}{p.size ? ` · ${p.size}` : ""}
                              </div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontWeight: 800, fontSize: 14 }}>{fmtMoney(p.sell_price)}</div>
                              <div style={{ fontSize: 12, marginTop: 2, color: stock > 0 ? "#9ca3af" : "#dc2626" }}>
                                Stok: {stock}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}

            {/* Barcode input — the main action */}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <input
                ref={inputRef}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addByBarcode(barcode); } }}
                placeholder="Barkod okut…"
                disabled={busy}
                inputMode="numeric"
                style={P.barcodeInput}
                autoFocus
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

            {err && <div style={P.errBox}>{err}</div>}
          </div>

          {/* ── Cart card ── */}
          <div style={{ ...P.card, marginTop: 10, padding: 0, overflow: "hidden" }}>

            <div style={P.cartHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 800, fontSize: 15, color: "#111827" }}>Sepet</span>
                {cart.length > 0 && <span style={P.countBadge}>{cart.length}</span>}
              </div>
              {cart.length > 0 && (
                <button type="button" onClick={resetSale} disabled={busy} style={P.clearBtn}>
                  Temizle
                </button>
              )}
            </div>

            {cart.length === 0
              ? (
                <div style={P.emptyState}>
                  <div style={{ fontSize: 32, opacity: 0.2 }}>🛍</div>
                  <div style={{ fontWeight: 600, color: "#6b7280", marginTop: 8 }}>Sepet boş</div>
                  <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 4 }}>Barkod okutun veya ürün arayın</div>
                </div>
              )
              : cart.map((l, i) => (
                <div key={l.barcode} style={{ ...P.cartItem, borderTop: i === 0 ? "none" : "1px solid #f3f4f6" }}>

                  {/* Main row */}
                  <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>

                    {/* Qty pill */}
                    <div style={P.qtyPill}>
                      <button
                        type="button"
                        disabled={busy || l.qty <= 1}
                        onClick={() => updateLine(l.barcode, { qty: l.qty - 1 })}
                        style={{ ...P.qtyBtn, opacity: l.qty <= 1 ? 0.25 : 1 }}
                      >−</button>
                      <span style={P.qtyNum}>{l.qty}</span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => updateLine(l.barcode, { qty: l.qty + 1 })}
                        style={P.qtyBtn}
                      >+</button>
                    </div>

                    {/* Product info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={P.itemName}>{l.name}</div>
                      <div style={P.itemMeta}>
                        {l.color && <span>{l.color}</span>}
                        {l.size && <span style={P.sizePill}>{l.size}</span>}
                        <select
                          value={l.sold_from}
                          onChange={(e) => updateLine(l.barcode, { sold_from: e.target.value as SoldFrom })}
                          disabled={busy}
                          style={P.fromSelect}
                        >
                          <option value="MAGAZA">Mağaza</option>
                          <option value="DEPO">Depo</option>
                        </select>
                      </div>
                    </div>

                    {/* Price + remove */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
                      {l.discount_enabled && l.unit_price !== l.list_price && (
                        <div style={P.strikePrice}>{fmtMoney(l.qty * l.list_price)}</div>
                      )}
                      <div style={P.lineTotal}>{fmtMoney(l.qty * l.unit_price)}</div>
                      {l.qty > 1 && (
                        <div style={{ fontSize: 11, color: "#9ca3af" }}>{fmtMoney(l.unit_price)} / ad</div>
                      )}
                      <button
                        type="button"
                        onClick={() => removeLine(l.barcode)}
                        disabled={busy}
                        style={P.removeBtn}
                      >✕</button>
                    </div>
                  </div>

                  {/* Discount row */}
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => updateLine(l.barcode, { discount_enabled: !l.discount_enabled })}
                      style={{ ...P.discountLink, color: l.discount_enabled ? "#b45309" : "#9ca3af" }}
                    >
                      {l.discount_enabled ? "İndirim ▾" : "+ İndirim"}
                    </button>

                    {l.discount_enabled && (
                      <>
                        {/* ₺ / % toggle */}
                        <div style={P.typeToggle}>
                          {(["TL", "PCT"] as const).map((t) => (
                            <button key={t} type="button" disabled={busy}
                              onClick={() => updateLine(l.barcode, { discount_type: t, discount_amount: 0 })}
                              style={{ ...P.typeBtn, background: l.discount_type === t ? "#111827" : "#f3f4f6", color: l.discount_type === t ? "#fff" : "#374151" }}
                            >
                              {t === "TL" ? "₺" : "%"}
                            </button>
                          ))}
                        </div>
                        {/* Amount input */}
                        <input
                          value={l.discount_amount === 0 ? "" : l.discount_amount}
                          placeholder={l.discount_type === "PCT" ? "%" : "₺"}
                          onChange={(e) => updateLine(l.barcode, { discount_amount: Number(e.target.value) || 0 })}
                          disabled={busy}
                          inputMode="decimal"
                          style={P.discountInput}
                        />
                        {/* Shortcuts */}
                        {(l.discount_type === "PCT" ? [5, 10, 20] : [10, 20, 50]).map((v) => (
                          <button key={v} type="button" disabled={busy}
                            onClick={() => updateLine(l.barcode, { discount_amount: v })}
                            style={P.shortcut}
                          >
                            {l.discount_type === "PCT" ? `%${v}` : `${v}₺`}
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* ── RIGHT COLUMN: Payment ── */}
        <div style={{ minWidth: 0 }}>
          <div style={isNarrow ? {} : { position: "sticky", top: 16 }}>
            <div style={P.payCard}>

              {/* Total */}
              <div style={P.totalBlock}>
                <div style={P.totalLabel}>Toplam</div>
                <div style={P.totalAmount}>{fmtMoney(total)}</div>
                {cart.length > 0 && (
                  <div style={P.totalSub}>
                    {cart.length} çeşit · {cart.reduce((s, l) => s + l.qty, 0)} adet
                  </div>
                )}
              </div>

              {/* Payment toggle */}
              <div style={{ marginTop: 18 }}>
                <div style={P.payLabel}>Ödeme</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
                  <button type="button" disabled={busy} onClick={() => setPaymentMethod("CARD")}
                    style={paymentMethod === "CARD" ? P.payBtnOn : P.payBtnOff}
                  >
                    💳 Kart
                  </button>
                  <button type="button" disabled={busy} onClick={() => setPaymentMethod("CASH")}
                    style={paymentMethod === "CASH" ? P.payBtnOn : P.payBtnOff}
                  >
                    💵 Nakit
                  </button>
                </div>
              </div>

              {/* CTA */}
              <button
                type="button"
                onClick={commitSale}
                disabled={busy || cart.length === 0}
                style={{ ...P.ctaBtn, opacity: busy || cart.length === 0 ? 0.4 : 1 }}
              >
                Satışı Tamamla
              </button>

              {/* Secondary */}
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                <button type="button" onClick={undoLastSale} disabled={busy} style={P.ghostBtn}>
                  ↩ Son satışı geri al
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const P: Record<string, React.CSSProperties> = {
  page: {
    padding: 20,
    fontFamily: "system-ui, -apple-system, sans-serif",
    minHeight: "100%",
    boxSizing: "border-box",
  },
  grid: {
    display: "grid",
    gap: 16,
    alignItems: "start",
  },
  leftCol: { minWidth: 0 },

  // cards
  card: {
    background: "#fff",
    borderRadius: 14,
    padding: 18,
    border: "1px solid #EAE8E5",
  },

  // scan bar
  scanBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    marginBottom: 2,
  },
  scanLabel: {
    fontSize: 12,
    fontWeight: 800,
    color: "#9ca3af",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  locationPill: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#fafaf9",
    fontSize: 13,
    fontWeight: 700,
    color: "#374151",
    cursor: "pointer",
    outline: "none",
  },
  searchBtn: {
    padding: "6px 14px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#fafaf9",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    color: "#374151",
    whiteSpace: "nowrap",
  },

  // barcode
  barcodeInput: {
    flex: 1,
    width: "100%",
    padding: "14px 16px",
    borderRadius: 14,
    border: "1.5px solid #e5e7eb",
    fontSize: 22,
    fontWeight: 800,
    outline: "none",
    background: "#fafaf9",
    letterSpacing: 0.5,
    boxSizing: "border-box",
    color: "#111827",
  },
  addBtn: {
    padding: "0 24px",
    height: 54,
    borderRadius: 14,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontSize: 15,
    fontWeight: 800,
    cursor: "pointer",
    whiteSpace: "nowrap",
    flexShrink: 0,
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

  // search dropdown
  searchDrop: {
    position: "absolute",
    top: "calc(100% + 6px)",
    left: 0,
    right: 0,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    boxShadow: "0 16px 40px rgba(0,0,0,0.1)",
    zIndex: 100,
    maxHeight: 320,
    overflow: "auto",
  },
  searchItem: {
    padding: "11px 16px",
    cursor: "pointer",
    borderBottom: "1px solid #f9fafb",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    background: "#fff",
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
  cartItem: {
    padding: "14px 18px",
  },

  // cart item internals
  qtyPill: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    background: "#f7f7f5",
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "3px 4px",
    flexShrink: 0,
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
  itemName: {
    fontWeight: 800,
    fontSize: 15,
    color: "#111827",
    lineHeight: 1.3,
  },
  itemMeta: {
    display: "flex",
    gap: 6,
    marginTop: 4,
    fontSize: 12,
    color: "#9ca3af",
    alignItems: "center",
    flexWrap: "wrap",
  },
  sizePill: {
    background: "#f3f4f6",
    borderRadius: 5,
    padding: "1px 6px",
    fontWeight: 700,
    color: "#374151",
    fontSize: 12,
  },
  fromSelect: {
    padding: "3px 7px",
    borderRadius: 7,
    border: "1px solid #e5e7eb",
    background: "#fafaf9",
    fontSize: 12,
    fontWeight: 700,
    color: "#374151",
    cursor: "pointer",
    outline: "none",
  },
  strikePrice: {
    fontSize: 12,
    color: "#9ca3af",
    textDecoration: "line-through",
  },
  lineTotal: {
    fontSize: 16,
    fontWeight: 900,
    color: "#111827",
  },
  removeBtn: {
    width: 26,
    height: 26,
    borderRadius: 6,
    border: "1px solid #e5e7eb",
    background: "#fff",
    cursor: "pointer",
    fontSize: 13,
    color: "#9ca3af",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
    padding: 0,
  },

  // discount
  discountLink: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    padding: 0,
  },
  typeToggle: {
    display: "flex",
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid #e5e7eb",
  },
  typeBtn: {
    padding: "4px 10px",
    border: "none",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 800,
  },
  discountInput: {
    width: 60,
    padding: "5px 8px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    fontSize: 13,
    fontWeight: 700,
    outline: "none",
  },
  shortcut: {
    padding: "4px 9px",
    borderRadius: 7,
    border: "1px solid #e5e7eb",
    background: "#fff",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 700,
    color: "#374151",
  },

  // payment panel
  payCard: {
    background: "#fff",
    borderRadius: 14,
    padding: 20,
    border: "1px solid #EAE8E5",
  },
  totalBlock: {
    background: "#FAF9F8",
    borderRadius: 10,
    padding: "18px 18px",
    border: "1px solid #EAE8E5",
  },
  totalLabel: {
    fontSize: 11,
    fontWeight: 800,
    color: "#6b7280",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  totalAmount: {
    fontSize: 40,
    fontWeight: 950,
    color: "#111827",
    lineHeight: 1.1,
    marginTop: 4,
    letterSpacing: -1,
  },
  totalSub: {
    fontSize: 12,
    color: "#9ca3af",
    marginTop: 6,
  },
  payLabel: {
    fontSize: 11,
    fontWeight: 800,
    color: "#9ca3af",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  payBtnOn: {
    padding: "13px 10px",
    borderRadius: 13,
    border: "2px solid #111827",
    background: "#111827",
    color: "#fff",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
  },
  payBtnOff: {
    padding: "13px 10px",
    borderRadius: 13,
    border: "2px solid #e5e7eb",
    background: "#fff",
    color: "#374151",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
  },
  ctaBtn: {
    marginTop: 14,
    width: "100%",
    padding: "17px 12px",
    borderRadius: 15,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontSize: 16,
    fontWeight: 900,
    cursor: "pointer",
    letterSpacing: 0.1,
  },
  ghostBtn: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    color: "#6b7280",
    textAlign: "center",
  },
};
