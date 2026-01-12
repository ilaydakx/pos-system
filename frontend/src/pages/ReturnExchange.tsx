import React, { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm, message } from "@tauri-apps/plugin-dialog";


type Loc = "MAGAZA" | "DEPO";

type PaymentMethod = "CASH" | "CARD";

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
  // sales tablosundaki satır
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

export function ReturnExchange() {
  const [err, setErr] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // giriş barkodu (iade/değişim yapılacak ürün)
  const [barcode, setBarcode] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [product, setProduct] = useState<Product | null>(null);
  const [history, setHistory] = useState<SaleLine[]>([]);
  const [selected, setSelected] = useState<SaleLine | null>(null);

  const [mode, setMode] = useState<"REFUND" | "EXCHANGE">("REFUND");
  const [diffPaymentMethod, setDiffPaymentMethod] = useState<"CASH" | "CARD">("CASH");
  // iade adet ve iade stok lokasyonu
  const [returnQty, setReturnQty] = useState(1);
  const [returnTo, setReturnTo] = useState<Loc>("MAGAZA");

  // satış geçmişi yoksa devam onayı
  const [allowNoHistory, setAllowNoHistory] = useState(false);

  // değişimde verilecek ürünler sepeti
  const [giveBarcode, setGiveBarcode] = useState("");
  const [cart, setCart] = useState<ExchangeCartItem[]>([]);

  // ---------- helpers ----------

  const focusBarcode = () => setTimeout(() => inputRef.current?.focus(), 50);

  const soldAtText = (s: string) => {
    return s.replace("T", " ").slice(0, 19);
  };

  const fmtMoney = (v: number) =>
    new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
      maximumFractionDigits: 2,
    }).format(Number.isFinite(v) ? v : 0);

  const refundableMax = useMemo(() => {
    if (!selected) return 0;
    const refunded = Math.max(0, Number(selected.refunded_qty ?? 0));
    const max = Math.max(0, selected.qty - refunded);
    return max;
  }, [selected]);

  useEffect(() => {
    if (!selected) {
      setReturnQty(1);
      return;
    }
    const max = refundableMax;
    if (max <= 0) setReturnQty(1);
    else setReturnQty((q) => Math.min(Math.max(1, q), max));

    // satış nereden yapıldıysa kullanıcı görsün ama iade varsayılan MAGAZA
    setReturnTo("MAGAZA");
  }, [selected, refundableMax]);

  const returnUnitPrice = selected?.unit_price ?? 0;
  const returnTotal = returnUnitPrice * (returnQty || 0);

  const cartTotal = useMemo(
    () => cart.reduce((sum, it) => sum + (it.unit_price || 0) * (it.qty || 0), 0),
    [cart]
  );

  const diff = useMemo(() => cartTotal - returnTotal, [cartTotal, returnTotal]);

  useEffect(() => {
    if (diff > 0 && !diffPaymentMethod) setDiffPaymentMethod("CASH");
  }, [diff]);

  const clearAll = () => {
    setErr("");
    setProduct(null);
    setHistory([]);
    setSelected(null);
    setAllowNoHistory(false);
    setReturnQty(1);
    setReturnTo("MAGAZA");
    setGiveBarcode("");
    setCart([]);
    setDiffPaymentMethod("CASH");
  };

  // ---------- backend calls ----------

  const fetchProductAndHistory = async (bc: string) => {
    setLoading(true);
    setErr("");
    setAllowNoHistory(false);
    setSelected(null);
    setHistory([]);
    setProduct(null);

    try {
      // 1) ürün
      const p = await invoke<Product | null>("find_product", { barcode: bc });
      if (!p) {
        setErr("Ürün bulunamadı.");
        return;
      }
      setProduct(p);

      // 2) son 15 gün satış geçmişi
      try {
        const rows = await invoke<SaleLine[]>("list_sales_by_barcode", {
          payload: {
            barcode: bc.trim(),
            days: DAYS,
          },
        });
        const sorted = [...rows].sort((a, b) => (a.sold_at < b.sold_at ? 1 : -1));
        setHistory(sorted);
      } catch (e) {
        setHistory([]);
        console.warn("list_sales_by_barcode failed:", e);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const scanReturnBarcode = async () => {
    const bc = barcode.trim();
    if (!bc) return;
    clearAll();
    setBarcode(bc);
    await fetchProductAndHistory(bc);
  };

  const scanGiveBarcode = async () => {
    const bc = giveBarcode.trim();
    if (!bc) return;
    setErr("");

    try {
      const p = await invoke<Product | null>("find_product", { barcode: bc });
      if (!p) {
        await message("Ürün bulunamadı", { title: "Değişim" });
        return;
      }

      setCart((prev) => {
        const idx = prev.findIndex((x) => x.barcode === bc);
        if (idx >= 0) {
          const cp = [...prev];
          cp[idx] = { ...cp[idx], qty: cp[idx].qty + 1 };
          return cp;
        }
        return [
          ...prev,
          {
            barcode: p.barcode,
            name: p.name,
            qty: 1,
            sold_from: "MAGAZA",
            unit_price: p.sell_price,
          },
        ];
      });

      setGiveBarcode("");
    } catch (e) {
      setErr(String(e));
    }
  };

  const ensureCanProceedWithoutHistory = async (): Promise<boolean> => {
    if (history.length > 0) return true;
    if (allowNoHistory) return true;

    const ok = await confirm(
      `Bu barkod için son ${DAYS} gün içinde satış bulunamadı. Yine de devam etmek ister misin?`,
      { title: "Satış bulunamadı", kind: "warning" }
    );

    if (ok) setAllowNoHistory(true);
    return ok;
  };

  const completeRefund = async () => {
    if (!product) return;

    const okNoHistory = await ensureCanProceedWithoutHistory();
    if (!okNoHistory) return;

    if (history.length > 0 && !selected) {
      await message("Lütfen listeden bir satış satırı seç.", { title: "İade" });
      return;
    }

    const unit_price = selected?.unit_price ?? 0;

    const payload = {
      barcode: product.barcode,
      qty: returnQty,
      return_to: returnTo,
      sold_at: selected?.sold_at ?? null,
      sold_from: selected?.sold_from ?? null,
      unit_price,
      mode: "REFUND",
    };

    try {
      setLoading(true);
      setErr("");

      await invoke("create_return", { payload });

      await message("İade tamamlandı.", { title: "İade / Değişim" });

      // Yeniden yükle
      await fetchProductAndHistory(product.barcode);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  const completeExchange = async () => {
    if (!product) return;

    const okNoHistory = await ensureCanProceedWithoutHistory();
    if (!okNoHistory) return;

    if (history.length > 0 && !selected) {
      await message("Lütfen listeden bir satış satırı seç.", { title: "Değişim" });
      return;
    }

    if (cart.length === 0) {
      await message("Değişim için verilecek ürün sepeti boş.", { title: "Değişim" });
      return;
    }

    const payload = {
      diff_paid_by_customer: diff > 0,
      returned: {
        barcode: product.barcode,
        qty: returnQty,
        return_to: returnTo,
        sold_at: selected?.sold_at ?? null,
        sold_from: selected?.sold_from ?? null,
        unit_price: selected?.unit_price ?? 0,
      },
      given: cart.map((x) => ({
        barcode: x.barcode,
        qty: x.qty,
        sold_from: x.sold_from,
        unit_price: x.unit_price,
      })),
      summary: {
        returned_total: returnTotal,
        given_total: cartTotal,
        diff,
        diff_payment_method: diff > 0 ? diffPaymentMethod : null,
      },
      mode: "EXCHANGE",
    };

    const ok = await confirm(
      `İşlemi tamamla?\n\nİade: ${fmtMoney(returnTotal)}\nVerilen: ${fmtMoney(cartTotal)}\nFark: ${fmtMoney(diff)}${diff > 0 ? `\nFark Ödeme: ${diffPaymentMethod === "CASH" ? "Nakit" : "Kart"}` : ""}`,
      { title: "Değişimi tamamla", kind: "info" }
    );
    if (!ok) return;

    try {
      setLoading(true);
      setErr("");

      await invoke("create_exchange", { payload });

      await message("Değişim tamamlandı.", { title: "İade / Değişim" });

      setCart([]);
      setGiveBarcode("");
      await fetchProductAndHistory(product.barcode);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  // ---------- UI ----------

  useEffect(() => {
    focusBarcode();
  }, []);

  const headerRight = (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <button onClick={() => { clearAll(); setBarcode(""); focusBarcode(); }} disabled={loading}>
        Temizle
      </button>
    </div>
  );

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>İade / Değişim</h2>
        <div style={{ marginLeft: "auto" }}>{headerRight}</div>
      </div>

      {/* Barkod giriş */}
      <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          ref={inputRef}
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          placeholder="İade/Değişim yapılacak ürün barkodu okut"
          style={{ flex: 1, padding: 10 }}
          onKeyDown={(e) => {
            if (e.key === "Enter") scanReturnBarcode();
          }}
          disabled={loading}
        />
        <button onClick={scanReturnBarcode} disabled={loading || !barcode.trim()}>
          Bul
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>❌ {err}</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 16, marginTop: 16 }}>
        {/* Sol: ürün + geçmiş */}
        <div>
          {/* Ürün kartı */}
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <div>
                <div style={{ fontSize: 14, opacity: 0.8 }}>Ürün</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>{product ? product.name : "-"}</div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                  Barkod: <b>{product?.barcode ?? "-"}</b>
                  {product?.product_code ? (
                    <>
                      {" "}• Kod: <b>{product.product_code}</b>
                    </>
                  ) : null}
                  {product?.category ? (
                    <>
                      {" "}• Kategori: <b>{product.category}</b>
                    </>
                  ) : null}
                </div>
                <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                  {product?.color ? <>Renk: <b>{product.color}</b></> : null}
                  {product?.size ? <> {" "}• Beden: <b>{product.size}</b></> : null}
                </div>
              </div>

              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 14, opacity: 0.8 }}>Stok</div>
                <div style={{ fontSize: 13, marginTop: 6 }}>
                  Mağaza: <b>{product ? product.magaza_stok : 0}</b>
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  Depo: <b>{product ? product.depo_stok : 0}</b>
                </div>
                <div style={{ fontSize: 13, marginTop: 4, opacity: 0.9 }}>
                  Toplam: <b>{product ? product.magaza_stok + product.depo_stok : 0}</b>
                </div>
              </div>
            </div>

            <div style={{ marginTop: 10, fontSize: 13, opacity: 0.8 }}>
              Son {DAYS} gün satış geçmişi aşağıda. Bulunamazsa devam edebilirsin.
            </div>
          </div>

          {/* Geçmiş */}
          <div style={{ ...card, marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ fontWeight: 700 }}>Satın alım geçmişi (son {DAYS} gün)</div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{history.length} kayıt</div>
            </div>

            {loading ? (
              <div style={{ marginTop: 10, opacity: 0.8 }}>Yükleniyor...</div>
            ) : history.length === 0 ? (
              <div style={{ marginTop: 10, opacity: 0.75 }}>
                Satış bulunamadı.
                {allowNoHistory ? (
                  <div style={{ marginTop: 6, color: "seagreen" }}>Devam izni verildi.</div>
                ) : (
                  <div style={{ marginTop: 6, opacity: 0.8 }}>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ marginTop: 10, overflow: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                  <thead>
                    <tr>
                      {[
                        "Seç",
                        "Tarih",
                        "Adet",
                        "Birim",
                        "Toplam",
                        "Nereden",
                        "Kalan",
                      ].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            borderBottom: "1px solid #ddd",
                            padding: "8px",
                            position: "sticky",
                            top: 0,
                            background: "white",
                            fontSize: 13,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((s, idx) => {
                      const refunded = Math.max(0, Number(s.refunded_qty ?? 0));
                      const left = Math.max(0, s.qty - refunded);
                      const disabled = left <= 0;
                      const isSel = selected?.sold_at === s.sold_at && selected?.unit_price === s.unit_price && selected?.qty === s.qty;

                      return (
                        <tr key={idx} style={{ opacity: disabled ? 0.5 : 1 }}>
                          <td style={cell}>
                            <input
                              type="radio"
                              name="sale"
                              disabled={disabled}
                              checked={isSel}
                              onChange={() => setSelected(s)}
                            />
                          </td>
                          <td style={cell}>{soldAtText(s.sold_at)}</td>
                          <td style={cell}>{s.qty}</td>
                          <td style={cell}>{fmtMoney(s.unit_price)}</td>
                          <td style={cell}>{fmtMoney(s.total)}</td>
                          <td style={cell}>{s.sold_from}</td>
                          <td style={cellStrong}>{left}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Sağ: işlem paneli */}
        <div>
          <div style={card}>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => setMode("REFUND")}
                disabled={!product || loading}
                style={mode === "REFUND" ? btnActive : btn}
              >
                İade
              </button>
              <button
                onClick={() => setMode("EXCHANGE")}
                disabled={!product || loading}
                style={mode === "EXCHANGE" ? btnActive : btn}
              >
                Değişim
              </button>
            </div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>İade adedi</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, refundableMax || 999)}
                    value={returnQty}
                    onChange={(e) => setReturnQty(Math.max(1, Number(e.target.value || 1)))}
                    style={{ width: 120, padding: 8 }}
                    disabled={!product || loading}
                  />
                  {history.length > 0 ? (
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      Seçili satıştan max: <b>{refundableMax}</b>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, opacity: 0.75 }}></div>
                  )}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, opacity: 0.8 }}>İade stoğu nereye girsin?</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <select
                    value={returnTo}
                    onChange={(e) => setReturnTo(e.target.value as Loc)}
                    style={{ flex: 1, padding: 8 }}
                    disabled={!product || loading}
                  >
                    <option value="MAGAZA">Mağaza</option>
                    <option value="DEPO">Depo</option>
                  </select>
                </div>
              </div>

              <div style={{ borderTop: "1px solid #eee", paddingTop: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <div style={{ fontSize: 13, opacity: 0.8 }}>İade tutarı</div>
                  <div style={{ fontWeight: 800 }}>{fmtMoney(returnTotal)}</div>
                </div>
                <div style={{ marginTop: 6, fontSize: 12, opacity: 0.75 }}>
                  Fiyat, seçtiğin satış satırının birim fiyatından gelir (indirimli ise indirimli).
                </div>
              </div>
            </div>

            {mode === "REFUND" ? (
              <div style={{ marginTop: 14 }}>
                <button
                  onClick={completeRefund}
                  disabled={!product || loading || returnQty <= 0}
                  style={{ width: "100%", padding: 10, fontWeight: 700 }}
                >
                  İadeyi Tamamla
                </button>
              </div>
            ) : (
              <>
                <div style={{ borderTop: "1px solid #eee", marginTop: 14, paddingTop: 14 }}>
                  <div style={{ fontWeight: 700 }}>Verilecek ürünler (değişim sepeti)</div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <input
                      value={giveBarcode}
                      onChange={(e) => setGiveBarcode(e.target.value)}
                      placeholder="Yeni ürün barkodu okut"
                      style={{ flex: 1, padding: 10 }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") scanGiveBarcode();
                      }}
                      disabled={!product || loading}
                    />
                    <button onClick={scanGiveBarcode} disabled={!product || loading || !giveBarcode.trim()}>
                      Ekle
                    </button>
                  </div>

                  {cart.length === 0 ? (
                    <div style={{ marginTop: 10, opacity: 0.75 }}>Sepet boş.</div>
                  ) : (
                    <div style={{ marginTop: 10, overflow: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 360 }}>
                        <thead>
                          <tr>
                            {[
                              "Ürün",
                              "Adet",
                              "Nereden",
                              "Birim",
                              "Toplam",
                              "Sil",
                            ].map((h) => (
                              <th
                                key={h}
                                style={{
                                  textAlign: "left",
                                  borderBottom: "1px solid #ddd",
                                  padding: "8px",
                                  fontSize: 13,
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
                          {cart.map((it) => {
                            const total = it.unit_price * it.qty;
                            return (
                              <tr key={it.barcode}>
                                <td style={cell}>
                                  <div style={{ fontWeight: 700 }}>{it.name}</div>
                                  <div style={{ fontSize: 12, opacity: 0.75 }}>{it.barcode}</div>
                                </td>
                                <td style={cell}>
                                  <input
                                    type="number"
                                    min={1}
                                    value={it.qty}
                                    onChange={(e) => {
                                      const q = Math.max(1, Number(e.target.value || 1));
                                      setCart((prev) =>
                                        prev.map((x) => (x.barcode === it.barcode ? { ...x, qty: q } : x))
                                      );
                                    }}
                                    style={{ width: 70, padding: 6 }}
                                    disabled={loading}
                                  />
                                </td>
                                <td style={cell}>
                                  <select
                                    value={it.sold_from}
                                    onChange={(e) => {
                                      const v = e.target.value as Loc;
                                      setCart((prev) =>
                                        prev.map((x) => (x.barcode === it.barcode ? { ...x, sold_from: v } : x))
                                      );
                                    }}
                                    style={{ padding: 6 }}
                                    disabled={loading}
                                  >
                                    <option value="MAGAZA">MAGAZA</option>
                                    <option value="DEPO">DEPO</option>
                                  </select>
                                </td>
                                <td style={cell}>{fmtMoney(it.unit_price)}</td>
                                <td style={cellStrong}>{fmtMoney(total)}</td>
                                <td style={cell}>
                                  <button
                                    onClick={() => setCart((prev) => prev.filter((x) => x.barcode !== it.barcode))}
                                    disabled={loading}
                                    style={{ cursor: "pointer" }}
                                  >
                                    🗑
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div style={{ borderTop: "1px solid #eee", marginTop: 12, paddingTop: 12 }}>
                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <div style={{ opacity: 0.8 }}>İade</div>
                        <div style={{ fontWeight: 800 }}>{fmtMoney(returnTotal)}</div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <div style={{ opacity: 0.8 }}>Verilen</div>
                        <div style={{ fontWeight: 800 }}>{fmtMoney(cartTotal)}</div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <div style={{ opacity: 0.8 }}>Fark</div>
                        <div style={{ fontWeight: 900 }}>{fmtMoney(diff)}</div>
                      </div>
                    </div>

                    {diff > 0 && (
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
                        <div style={{ fontWeight: 700 }}>Fark Ödeme:</div>

                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="radio"
                            name="diffpm"
                            checked={diffPaymentMethod === "CASH"}
                            onChange={() => setDiffPaymentMethod("CASH")}
                          />
                          Nakit
                        </label>

                        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <input
                            type="radio"
                            name="diffpm"
                            checked={diffPaymentMethod === "CARD"}
                            onChange={() => setDiffPaymentMethod("CARD")}
                          />
                          Kart
                        </label>
                      </div>
                    )}

                    <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                      <button
                        onClick={() => setCart([])}
                        disabled={loading || cart.length === 0}
                        style={{ flex: 1, padding: 10 }}
                      >
                        Sepeti Temizle
                      </button>
                      <button
                        onClick={completeExchange}
                        disabled={!product || loading || returnQty <= 0 || cart.length === 0}
                        style={{ flex: 1, padding: 10, fontWeight: 800 }}
                      >
                        Değişimi Tamamla
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.75, lineHeight: 1.4 }}>
            
          </div>
        </div>
      </div>
    </div>
  );
}
/*
// satış lokasyonu kolon adı
function col_for_loc(loc: string): string {
  const up = (loc || "").toUpperCase();
  return up === "DEPO" ? "depo_stok" : "magaza_stok";
}

// basit id üretimi (chrono yoksa bile çalışır)
function chrono_like_id() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const s = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(
    d.getMinutes()
  )}${pad(d.getSeconds())}`;
  const rnd = Math.floor(Math.random() * 1e6)
    .toString()
    .padStart(6, "0");
  return `${s}-${rnd}`;
}
*/
const card: React.CSSProperties = {
  border: "1px solid #e7e7e7",
  borderRadius: 12,
  padding: 12,
  background: "white",
};

const cell: React.CSSProperties = {
  padding: "8px",
  borderBottom: "1px solid #f0f0f0",
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

const cellStrong: React.CSSProperties = {
  ...cell,
  fontWeight: 700,
};

const btn: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  cursor: "pointer",
};

const btnActive: React.CSSProperties = {
  ...btn,
  fontWeight: 800,
  outline: "2px solid #111",
};