import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm, message } from "@tauri-apps/plugin-dialog";

type Loc = "MAGAZA" | "DEPO";

type Product = {
  barcode: string;
  name: string;
  product_code?: string | null;
  category?: string | null;
  color?: string | null;
  size?: string | null;
  buy_price?: number | null;
  sell_price: number;
  stock: number;
  magaza_baslangic: number;
  depo_baslangic: number;
  magaza_stok: number;
  depo_stok: number;
};

type SaleLine = {
  id?: number;
  sold_at: string;
  qty: number;
  unit_price: number;
  total: number;
  sold_from: Loc;
  refunded_qty?: number | null;
};

type ExchangeCartItem = {
  barcode: string;
  name: string;
  qty: number;
  sold_from: Loc;
  unit_price: number;
};

const DAYS = 15;

type SaleRowProps = {
  s: SaleLine;
  selected: SaleLine | null;
  onSelect: (s: SaleLine) => void;
};

function SaleRow({ s, selected, onSelect }: SaleRowProps) {
  const refunded = Math.max(0, Number(s.refunded_qty ?? 0));
  const left     = Math.max(0, s.qty - refunded);
  const disabled = left <= 0;
  const isSel    = !!(selected && (
    s.id != null && selected.id != null
      ? selected.id === s.id
      : selected.sold_at    === s.sold_at    &&
        selected.unit_price === s.unit_price &&
        selected.qty        === s.qty        &&
        selected.sold_from  === s.sold_from
  ));
  return (
    <div
      onClick={() => !disabled && onSelect(s)}
      style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "12px 14px", borderRadius: 12, flexWrap: "wrap" as const,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
        background: isSel ? "#f0fdf4" : "#fafaf9",
        border: isSel ? "1.5px solid #059669" : "1.5px solid #EAE8E5",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: "#111827" }}>{soldAtText(s.sold_at)}</div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
          {s.sold_from === "MAGAZA" ? "Mağaza" : "Depo"} · {s.qty} adet
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>{fmtMoney(s.total)}</div>
        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{fmtMoney(s.unit_price)} / ad</div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0, minWidth: 48 }}>
        <div style={{ fontSize: 10, color: "#9ca3af", fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 0.3 }}>Kalan</div>
        <div style={{ fontWeight: 900, fontSize: 16, color: left > 0 ? "#111827" : "#9ca3af" }}>{left}</div>
      </div>
      {isSel && <div style={{ color: "#16a34a", fontSize: 16, flexShrink: 0 }}>✓</div>}
    </div>
  );
}

function fmtMoney(v: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(Number.isFinite(v) ? v : 0);
}

function soldAtText(s: string) {
  return s.replace("T", " ").slice(0, 16);
}

export function ReturnExchange() {
  const [err, setErr]         = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [barcode, setBarcode] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [product, setProduct]   = useState<Product | null>(null);
  const [history, setHistory]   = useState<SaleLine[]>([]);
  const [selected, setSelected] = useState<SaleLine | null>(null);

  const [mode, setMode]                     = useState<"REFUND" | "EXCHANGE">("REFUND");
  const [diffPaymentMethod, setDiffPaymentMethod] = useState<"CASH" | "CARD">("CASH");
  const [returnQty, setReturnQty]           = useState(1);
  const [returnTo, setReturnTo]             = useState<Loc>("MAGAZA");

  const [giveBarcode, setGiveBarcode] = useState("");
  const [cart, setCart]               = useState<ExchangeCartItem[]>([]);

  const focusBarcode = () => setTimeout(() => inputRef.current?.focus(), 50);

  const refundableMax = useMemo(() => {
    if (!selected) return 0;
    return Math.max(0, selected.qty - Math.max(0, Number(selected.refunded_qty ?? 0)));
  }, [selected]);

  useEffect(() => {
    if (!selected) { setReturnQty(1); return; }
    const max = refundableMax;
    if (max <= 0) setReturnQty(1);
    else setReturnQty((q) => Math.min(Math.max(1, q), max));
    // Stok, satışın yapıldığı lokasyona geri döner — MAGAZA'ya değil.
    setReturnTo(selected.sold_from ?? "MAGAZA");
  }, [selected, refundableMax]);

  const returnUnitPrice = selected?.unit_price ?? 0;
  const returnTotal     = returnUnitPrice * (returnQty || 0);
  const cartTotal       = useMemo(() => cart.reduce((s, it) => s + it.unit_price * it.qty, 0), [cart]);
  const diff            = useMemo(() => cartTotal - returnTotal, [cartTotal, returnTotal]);

  useEffect(() => { if (diff > 0 && !diffPaymentMethod) setDiffPaymentMethod("CASH"); }, [diff]);

  const clearAll = () => {
    setErr(""); setProduct(null); setHistory([]); setSelected(null);
    setReturnQty(1); setReturnTo("MAGAZA");
    setMode("REFUND");
    setGiveBarcode(""); setCart([]); setDiffPaymentMethod("CASH");
  };

  const fetchProductAndHistory = async (bc: string) => {
    setLoading(true); setErr("");
    setSelected(null); setHistory([]); setProduct(null);
    try {
      const p = await invoke<Product | null>("find_product", { barcode: bc });
      if (!p) { setErr("Ürün bulunamadı."); return; }
      setProduct(p);
      try {
        const rows = await invoke<SaleLine[]>("list_sales_by_barcode", { payload: { barcode: bc.trim(), days: 9999 } });
        setHistory([...rows].sort((a, b) => a.sold_at < b.sold_at ? 1 : -1));
      } catch { setHistory([]); }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const scanReturnBarcode = async () => {
    const bc = barcode.trim();
    if (!bc) return;
    clearAll(); setBarcode(bc);
    await fetchProductAndHistory(bc);
  };

  const scanGiveBarcode = async () => {
    const bc = giveBarcode.trim();
    if (!bc) return;
    setErr("");
    try {
      const p = await invoke<Product | null>("find_product", { barcode: bc });
      if (!p) { await message("Ürün bulunamadı", { title: "Değişim" }); return; }
      setCart((prev) => {
        const idx = prev.findIndex((x) => x.barcode === bc);
        if (idx >= 0) { const cp = [...prev]; cp[idx] = { ...cp[idx], qty: cp[idx].qty + 1 }; return cp; }
        return [...prev, { barcode: p.barcode, name: p.name, qty: 1, sold_from: "MAGAZA", unit_price: p.sell_price }];
      });
      setGiveBarcode("");
    } catch (e) { setErr(String(e)); }
  };

  const completeRefund = async () => {
    if (!product) return;
    if (history.length === 0) { await message("Bu ürüne ait satış kaydı bulunamadı. İade yapılamaz.", { title: "İade Engellendi", kind: "warning" }); return; }
    if (!selected) { await message("Lütfen soldaki listeden bir satış satırı seçin.", { title: "İade" }); return; }
    try {
      setLoading(true); setErr("");
      await invoke("create_return", { payload: {
        barcode: product.barcode, qty: returnQty, return_to: returnTo,
        sold_at: selected?.sold_at ?? null, sold_from: selected?.sold_from ?? null,
        unit_price: selected?.unit_price ?? 0, mode: "REFUND",
      }});
      await message("İade tamamlandı.", { title: "İade / Değişim" });
      await fetchProductAndHistory(product.barcode);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  };

  const completeExchange = async () => {
    if (!product) return;
    if (history.length === 0) { await message("Bu ürüne ait satış kaydı bulunamadı. Değişim yapılamaz.", { title: "Değişim Engellendi", kind: "warning" }); return; }
    if (!selected) { await message("Lütfen listeden bir satış satırı seç.", { title: "Değişim" }); return; }
    if (cart.length === 0) { await message("Değişim için verilecek ürün sepeti boş.", { title: "Değişim" }); return; }
    const ok = await confirm(
      `İşlemi tamamla?\n\nİade: ${fmtMoney(returnTotal)}\nVerilen: ${fmtMoney(cartTotal)}\nFark: ${fmtMoney(diff)}${diff > 0 ? `\nFark Ödeme: ${diffPaymentMethod === "CASH" ? "Nakit" : "Kart"}` : ""}`,
      { title: "Değişimi tamamla", kind: "info" }
    );
    if (!ok) return;
    try {
      setLoading(true); setErr("");
      await invoke("create_exchange", { payload: {
        diff_paid_by_customer: diff > 0,
        returned: { barcode: product.barcode, qty: returnQty, return_to: returnTo,
          sold_at: selected?.sold_at ?? null, sold_from: selected?.sold_from ?? null,
          unit_price: selected?.unit_price ?? 0 },
        given: cart.map((x) => ({ barcode: x.barcode, qty: x.qty, sold_from: x.sold_from, unit_price: x.unit_price })),
        summary: { returned_total: returnTotal, given_total: cartTotal, diff, diff_payment_method: diff > 0 ? diffPaymentMethod : null },
        mode: "EXCHANGE",
      }});
      await message("Değişim tamamlandı.", { title: "İade / Değişim" });
      setCart([]); setGiveBarcode("");
      await fetchProductAndHistory(product.barcode);
    } catch (e) { setErr(String(e)); } finally { setLoading(false); }
  };

  useEffect(() => { focusBarcode(); }, []);

  return (
    <div style={P.page}>

      {/* ── Header ── */}
      <div style={P.header}>
        <div>
          <h2 style={P.title}>İade / Değişim</h2>
          <div style={P.subtitle}>Tüm satış geçmişine göre işlem yapılır</div>
        </div>
        {product && (
          <button type="button" onClick={() => { clearAll(); setBarcode(""); focusBarcode(); }} disabled={loading} style={P.ghostBtn}>
            Temizle
          </button>
        )}
      </div>

      {/* ── Barcode scan ── */}
      <div style={P.card}>
        <div style={P.fieldLabel}>İade / Değişim yapılacak ürün barkodu</div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <input
            ref={inputRef}
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") scanReturnBarcode(); }}
            placeholder="Barkod okut…"
            disabled={loading}
            inputMode="numeric"
            autoFocus
            style={P.barcodeInput}
          />
          <button
            type="button"
            onClick={scanReturnBarcode}
            disabled={loading || !barcode.trim()}
            style={{ ...P.addBtn, opacity: loading || !barcode.trim() ? 0.4 : 1 }}
          >
            {loading ? "…" : "Bul"}
          </button>
        </div>
        {err && <div style={P.errBox}>{err}</div>}
      </div>

      {/* ── Main content: product + panel ── */}
      {product && (
        <div style={P.grid}>

          {/* ── LEFT: product info + history ── */}
          <div style={{ minWidth: 0 }}>

            {/* Product card */}
            <div style={P.card}>
              <div style={{ display: "flex", gap: 16, justifyContent: "space-between", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={P.productName}>{product.name}</div>
                  <div style={P.productMeta}>
                    <span style={{ fontFamily: "monospace" }}>{product.barcode}</span>
                    {product.product_code && <span>Kod: {product.product_code}</span>}
                    {product.category    && <span>{product.category}</span>}
                    {product.color       && <span>{product.color}</span>}
                    {product.size        && <span style={P.sizePill}>{product.size}</span>}
                  </div>
                </div>
                <div style={P.stockBlock}>
                  <div style={P.stockRow}>
                    <span style={P.stockLabel}>Mağaza</span>
                    <span style={P.stockVal}>{product.magaza_stok}</span>
                  </div>
                  <div style={P.stockRow}>
                    <span style={P.stockLabel}>Depo</span>
                    <span style={P.stockVal}>{product.depo_stok}</span>
                  </div>
                  <div style={{ ...P.stockRow, borderTop: "1px solid #f3f4f6", paddingTop: 6, marginTop: 2 }}>
                    <span style={P.stockLabel}>Toplam</span>
                    <span style={{ ...P.stockVal, fontWeight: 900 }}>{product.magaza_stok + product.depo_stok}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* History */}
            <div style={{ ...P.card, marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontWeight: 800, fontSize: 14, color: "#111827" }}>Satış geçmişi</span>
                <span style={{ fontSize: 12, color: "#9ca3af" }}>{history.length} kayıt</span>
              </div>

              {loading ? (
                <div style={{ padding: "20px 0", textAlign: "center", color: "#9ca3af", fontSize: 13 }}>Yükleniyor…</div>
              ) : history.length === 0 ? (
                <div style={{ padding: "12px 14px", borderRadius: 12, background: "#fef2f2", border: "1px solid #fecaca" }}>
                  <div style={{ fontWeight: 700, color: "#b91c1c", fontSize: 13 }}>İade / Değişim yapılamaz</div>
                  <div style={{ fontSize: 12, color: "#9ca3af", marginTop: 4 }}>Bu ürüne ait satış kaydı bulunamadı.</div>
                </div>
              ) : (() => {
                const cutoff = new Date(Date.now() - DAYS * 86400 * 1000).toISOString();
                const recent = history.filter((s) => s.sold_at >= cutoff);
                const older  = history.filter((s) => s.sold_at < cutoff);
                return (
                  <div style={{ display: "grid", gap: 6 }}>
                    {recent.map((s) => (
                      <SaleRow key={s.id != null ? String(s.id) : `${s.sold_at}-${s.unit_price}-${s.qty}-${s.sold_from}`} s={s} selected={selected} onSelect={setSelected} />
                    ))}
                    {older.length > 0 && (
                      <>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0" }}>
                          <div style={{ flex: 1, height: 1, background: "#f0eeec" }} />
                          <span style={{ fontSize: 11, color: "#9ca3af", fontWeight: 600, whiteSpace: "nowrap" }}>Daha eski</span>
                          <div style={{ flex: 1, height: 1, background: "#f0eeec" }} />
                        </div>
                        {older.map((s) => (
                          <SaleRow key={s.id != null ? String(s.id) : `${s.sold_at}-${s.unit_price}-${s.qty}-${s.sold_from}`} s={s} selected={selected} onSelect={setSelected} />
                        ))}
                      </>
                    )}
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ── RIGHT: action panel ── */}
          <div style={{ minWidth: 0 }}>
            <div style={P.card}>

              {/* Mode toggle */}
              <div style={P.modeToggle}>
                <button type="button" disabled={!product || loading} onClick={() => setMode("REFUND")}
                  style={mode === "REFUND" ? P.modeOn : P.modeOff}
                >İade</button>
                <button type="button" disabled={!product || loading} onClick={() => setMode("EXCHANGE")}
                  style={mode === "EXCHANGE" ? P.modeOn : P.modeOff}
                >Değişim</button>
              </div>

              {/* Qty + return location */}
              <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                <div>
                  <div style={P.fieldLabel}>İade adedi</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                    <div style={P.qtyPill}>
                      <button type="button" disabled={loading || returnQty <= 1}
                        onClick={() => setReturnQty((q) => Math.max(1, q - 1))}
                        style={{ ...P.qtyBtn, opacity: returnQty <= 1 ? 0.25 : 1 }}
                      >−</button>
                      <span style={P.qtyNum}>{returnQty}</span>
                      <button type="button" disabled={loading || (refundableMax > 0 && returnQty >= refundableMax)}
                        onClick={() => setReturnQty((q) => refundableMax > 0 ? Math.min(q + 1, refundableMax) : q + 1)}
                        style={{ ...P.qtyBtn, opacity: (refundableMax > 0 && returnQty >= refundableMax) ? 0.25 : 1 }}
                      >+</button>
                    </div>
                    {refundableMax > 0 && (
                      <span style={{ fontSize: 12, color: "#9ca3af" }}>maks {refundableMax}</span>
                    )}
                  </div>
                </div>

                <div>
                  <div style={P.fieldLabel}>Stok nereye dönecek?</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                    {(["MAGAZA", "DEPO"] as Loc[]).map((loc) => (
                      <button key={loc} type="button" disabled={!product || loading}
                        onClick={() => setReturnTo(loc)}
                        style={returnTo === loc ? P.locOn : P.locOff}
                      >
                        {loc === "MAGAZA" ? "Mağaza" : "Depo"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Return total */}
                <div style={P.summaryRow}>
                  <span style={{ fontSize: 13, color: "#6b7280" }}>İade tutarı</span>
                  <span style={{ fontWeight: 900, fontSize: 16 }}>{fmtMoney(returnTotal)}</span>
                </div>
              </div>

              {/* REFUND CTA */}
              {mode === "REFUND" && (
                <button type="button"
                  onClick={completeRefund}
                  disabled={!product || loading || returnQty <= 0}
                  style={{ ...P.ctaBtn, marginTop: 16, opacity: !product || loading || returnQty <= 0 ? 0.4 : 1 }}
                >
                  İadeyi Tamamla
                </button>
              )}

              {/* EXCHANGE section */}
              {mode === "EXCHANGE" && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ borderTop: "1px solid #f3f4f6", paddingTop: 16 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: "#111827", marginBottom: 10 }}>Verilecek ürünler</div>

                    <div style={{ display: "flex", gap: 8 }}>
                      <input
                        value={giveBarcode}
                        onChange={(e) => setGiveBarcode(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") scanGiveBarcode(); }}
                        placeholder="Yeni ürün barkodu…"
                        disabled={!product || loading}
                        style={{ ...P.barcodeInput, fontSize: 15, padding: "10px 13px" }}
                      />
                      <button type="button" onClick={scanGiveBarcode}
                        disabled={!product || loading || !giveBarcode.trim()}
                        style={{ ...P.addBtn, opacity: !product || loading || !giveBarcode.trim() ? 0.4 : 1 }}
                      >Ekle</button>
                    </div>

                    {/* Exchange cart items */}
                    {cart.length === 0 ? (
                      <div style={{ marginTop: 10, color: "#9ca3af", fontSize: 13 }}>Sepet boş.</div>
                    ) : (
                      <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                        {cart.map((it) => (
                          <div key={it.barcode} style={P.cartRow}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 13 }}>{it.name}</div>
                              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 1, fontFamily: "monospace" }}>{it.barcode}</div>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                              {/* Qty */}
                              <div style={{ ...P.qtyPill, padding: "2px 3px" }}>
                                <button type="button" disabled={loading || it.qty <= 1}
                                  onClick={() => setCart((prev) => prev.map((x) => x.barcode === it.barcode ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}
                                  style={{ ...P.qtyBtn, width: 24, height: 24, opacity: it.qty <= 1 ? 0.25 : 1 }}
                                >−</button>
                                <span style={{ ...P.qtyNum, minWidth: 18, fontSize: 13 }}>{it.qty}</span>
                                <button type="button" disabled={loading}
                                  onClick={() => setCart((prev) => prev.map((x) => x.barcode === it.barcode ? { ...x, qty: x.qty + 1 } : x))}
                                  style={{ ...P.qtyBtn, width: 24, height: 24 }}
                                >+</button>
                              </div>
                              {/* Location */}
                              <select
                                value={it.sold_from}
                                onChange={(e) => setCart((prev) => prev.map((x) => x.barcode === it.barcode ? { ...x, sold_from: e.target.value as Loc } : x))}
                                disabled={loading}
                                style={P.smallSelect}
                              >
                                <option value="MAGAZA">Mağaza</option>
                                <option value="DEPO">Depo</option>
                              </select>
                              <span style={{ fontWeight: 700, fontSize: 13, minWidth: 60, textAlign: "right" }}>{fmtMoney(it.unit_price * it.qty)}</span>
                              <button type="button" disabled={loading}
                                onClick={() => setCart((prev) => prev.filter((x) => x.barcode !== it.barcode))}
                                style={P.removeBtn}
                              >✕</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Summary */}
                    <div style={{ marginTop: 14, borderTop: "1px solid #f3f4f6", paddingTop: 12, display: "grid", gap: 6 }}>
                      <div style={P.summaryRow}>
                        <span style={{ fontSize: 13, color: "#6b7280" }}>İade</span>
                        <span style={{ fontWeight: 700 }}>{fmtMoney(returnTotal)}</span>
                      </div>
                      <div style={P.summaryRow}>
                        <span style={{ fontSize: 13, color: "#6b7280" }}>Verilen</span>
                        <span style={{ fontWeight: 700 }}>{fmtMoney(cartTotal)}</span>
                      </div>
                      <div style={{ ...P.summaryRow, borderTop: "1px solid #f3f4f6", paddingTop: 8, marginTop: 2 }}>
                        <span style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>Fark</span>
                        <span style={{ fontSize: 18, fontWeight: 900, color: diff > 0 ? "#d97706" : diff < 0 ? "#dc2626" : "#111827" }}>
                          {fmtMoney(diff)}
                        </span>
                      </div>
                    </div>

                    {/* Diff payment */}
                    {diff > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={P.fieldLabel}>Fark ödeme yöntemi</div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 6 }}>
                          <button type="button" onClick={() => setDiffPaymentMethod("CASH")}
                            style={diffPaymentMethod === "CASH" ? P.locOn : P.locOff}
                          >💵 Nakit</button>
                          <button type="button" onClick={() => setDiffPaymentMethod("CARD")}
                            style={diffPaymentMethod === "CARD" ? P.locOn : P.locOff}
                          >💳 Kart</button>
                        </div>
                      </div>
                    )}

                    <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      <button type="button" onClick={() => setCart([])} disabled={loading || cart.length === 0}
                        style={{ ...P.ghostBtn, opacity: cart.length === 0 ? 0.4 : 1 }}
                      >Sepeti Temizle</button>
                      <button type="button" onClick={completeExchange}
                        disabled={!product || loading || returnQty <= 0 || cart.length === 0}
                        style={{ ...P.ctaBtn, opacity: !product || loading || returnQty <= 0 || cart.length === 0 ? 0.4 : 1 }}
                      >Değişimi Tamamla</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
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

  card: {
    background: "#fff",
    borderRadius: 14,
    padding: 18,
    border: "1px solid #EAE8E5",
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: "#9ca3af",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  barcodeInput: {
    flex: 1,
    padding: "13px 15px",
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
    height: 52,
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

  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) 340px",
    gap: 14,
    marginTop: 12,
    alignItems: "start",
  },

  // product card
  productName: {
    fontWeight: 900,
    fontSize: 18,
    color: "#111827",
  },
  productMeta: {
    display: "flex",
    gap: 8,
    marginTop: 6,
    fontSize: 12,
    color: "#6b7280",
    flexWrap: "wrap",
    alignItems: "center",
  },
  sizePill: {
    background: "#f3f4f6",
    borderRadius: 5,
    padding: "1px 7px",
    fontWeight: 700,
    color: "#374151",
    fontSize: 12,
  },
  stockBlock: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    flexShrink: 0,
    minWidth: 90,
  },
  stockRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "baseline",
  },
  stockLabel: {
    fontSize: 11,
    color: "#9ca3af",
    fontWeight: 600,
  },
  stockVal: {
    fontSize: 14,
    fontWeight: 800,
    color: "#111827",
  },

  // action panel
  modeToggle: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  modeOn: {
    padding: "11px 10px",
    borderRadius: 12,
    border: "2px solid #111827",
    background: "#111827",
    color: "#fff",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
  },
  modeOff: {
    padding: "11px 10px",
    borderRadius: 12,
    border: "2px solid #e5e7eb",
    background: "#fff",
    color: "#374151",
    fontSize: 14,
    fontWeight: 700,
    cursor: "pointer",
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
    width: 30,
    height: 30,
    borderRadius: 7,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    fontSize: 18,
    fontWeight: 700,
    color: "#374151",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  qtyNum: {
    minWidth: 24,
    textAlign: "center",
    fontWeight: 900,
    fontSize: 16,
    color: "#111827",
  },
  locOn: {
    padding: "10px",
    borderRadius: 11,
    border: "2px solid #111827",
    background: "#111827",
    color: "#fff",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  locOff: {
    padding: "10px",
    borderRadius: 11,
    border: "2px solid #e5e7eb",
    background: "#fff",
    color: "#374151",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
  },
  summaryRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  ctaBtn: {
    width: "100%",
    padding: "15px 12px",
    borderRadius: 14,
    border: "none",
    background: "#111827",
    color: "#fff",
    fontSize: 15,
    fontWeight: 900,
    cursor: "pointer",
  },

  // exchange cart
  cartRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 12,
    background: "#FAF9F8",
    border: "1px solid #EAE8E5",
    flexWrap: "wrap",
  },
  smallSelect: {
    padding: "5px 8px",
    borderRadius: 8,
    border: "1px solid #e5e7eb",
    background: "#fff",
    fontSize: 12,
    fontWeight: 700,
    color: "#374151",
    outline: "none",
    cursor: "pointer",
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
    padding: 0,
  },
};
