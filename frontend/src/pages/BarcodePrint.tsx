import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import BarcodeLabelSheet from "../components/BarcodeLabelSheet";
import type { LabelItem } from "../components/BarcodeLabelSheet";


type Product = {
  barcode: string;
  product_code?: string | null;
  name: string;
  sell_price: number;

  created_at?: string | null;

  color?: string | null;
  size?: string | null;

  magaza_stok?: number | null;
  depo_stok?: number | null;
  stock?: number | null;
};

function yyyyMmDdLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtMoney(v: number) {
  if (!Number.isFinite(v)) return "-";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(v);
}

function isCreatedToday(p: Product) {
  if (!p.created_at) return false;

  const s = p.created_at.slice(0, 10); 
  return s === yyyyMmDdLocal(new Date());
}
function productStock(p: Product): number {
  const ms = Number(p.magaza_stok ?? 0);
  const ds = Number(p.depo_stok ?? 0);
  const hasLoc = Number.isFinite(ms) || Number.isFinite(ds);

  if (hasLoc) {
    const total = (Number.isFinite(ms) ? ms : 0) + (Number.isFinite(ds) ? ds : 0);
    return Math.max(0, Math.floor(total));
  }

  const s = Number(p.stock ?? 0);
  return Math.max(0, Math.floor(Number.isFinite(s) ? s : 0));
}

export default function BarcodePrint() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [tab, setTab] = useState<"today" | "selected">("today");

  // seçilen ürünler (barcode)
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  // her ürün için kaç adet etiket
  const [qtyByBarcode, setQtyByBarcode] = useState<Record<string, number>>({});

  // yazdırma ayarları
  const [showPrice, setShowPrice] = useState(true);
  const [showCode, setShowCode] = useState(true);


  const [toast, setToast] = useState<string>("");
  const [busyPdf, setBusyPdf] = useState(false);

  const PRESET = {
    cols: 4,
    gapMm: 0,
    labelW: 52.5,
    labelH: 21.2,
    pagePaddingMm: 0,
  } as const;

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(""), 2200);
  };
  const downloadPdf = async () => {
  try {
    setBusyPdf(true);

    const el = document.getElementById("barcode-print-area");
    if (!el) throw new Error("Yazdırma alanı bulunamadı");

    const html2canvas = (await import("html2canvas")).default;
    const { jsPDF } = await import("jspdf");

    const canvas = await html2canvas(el, { scale: 2, backgroundColor: "#ffffff" });
    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    const imgW = pageW;
    const imgH = (canvas.height * imgW) / canvas.width;

    // Çok sayfa desteği (etiketler uzunsa)
    let y = 0;
    let remaining = imgH;

    while (remaining > 0) {
      pdf.addImage(imgData, "PNG", 0, y, imgW, imgH);
      remaining -= pageH;
      if (remaining > 0) {
        pdf.addPage();
        y -= pageH;
      }
    }

    pdf.save(`etiket_${yyyyMmDdLocal(new Date())}.pdf`);
    showToast("✅ PDF indirildi");
  } catch (e) {
    showToast(`❌ PDF indirilemedi: ${String(e)}`);
  } finally {
    setBusyPdf(false);
  }
};

  const load = async () => {
    try {
      setErr("");
      setLoading(true);

      const rows = await invoke<Product[]>("list_products");
      const list = rows || [];
      setProducts(list);

      // qty default = stok kadar (stok 0 ise 0)
      const q: Record<string, number> = {};
      for (const p of list) {
        q[p.barcode] = productStock(p);
      }
      setQtyByBarcode(q);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);
  const sortedProducts = useMemo(() => {
  const list = [...products];
  list.sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : Number.NaN;
    const tb = b.created_at ? Date.parse(b.created_at) : Number.NaN;

    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return tb - ta;
    if (!Number.isNaN(ta) && Number.isNaN(tb)) return -1;
    if (Number.isNaN(ta) && !Number.isNaN(tb)) return 1;

    const na = Number(a.barcode);
    const nb = Number(b.barcode);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;

    return String(b.barcode).localeCompare(String(a.barcode));
  });
  return list;
}, [products]);

  const todayProducts = useMemo(() => sortedProducts.filter(isCreatedToday), [sortedProducts]);

  const selectedProducts = useMemo(() => {
    const set = selected;
    return sortedProducts.filter((p) => !!set[p.barcode]);
  }, [sortedProducts, selected]);

  useEffect(() => {
  // stok 0 olanları seçili bırakma
  setSelected((prev) => {
    let changed = false;
    const next = { ...prev };
    for (const p of sortedProducts) {
      if (next[p.barcode] && productStock(p) <= 0) {
        delete next[p.barcode];
        changed = true;
      }
    }
    return changed ? next : prev;
  });
}, [sortedProducts]);
  const activeProducts = tab === "today" ? todayProducts : selectedProducts;

  const labels: LabelItem[] = useMemo(() => {
    const out: LabelItem[] = [];
    for (const p of activeProducts) {
      const st = productStock(p);
      const raw = qtyByBarcode[p.barcode];
      const qty = Math.max(0, Math.min(st, Math.floor(Number(raw ?? 0) || 0)));
      if (qty <= 0) continue;

      for (let i = 0; i < qty; i++) {
        out.push({
          barcode: p.barcode,
          title: p.name,
          productCode: p.product_code ?? "",
          priceText: fmtMoney(p.sell_price),
          size: p.size ?? "",
          color: p.color ?? "",
        });
      }
    }
    return out;
  }, [activeProducts, qtyByBarcode]);

  const toggleSelect = (barcode: string) => {
    setSelected((prev) => ({ ...prev, [barcode]: !prev[barcode] }));
  };

  const selectAllVisible = () => {
    const next: Record<string, boolean> = { ...selected };
    for (const p of sortedProducts) {
      if (productStock(p) > 0) next[p.barcode] = true;
    }
    setSelected(next);
  };

  const clearSelected = () => setSelected({});

  const canPrint = labels.length > 0;

  return (
    <div style={{ fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>🏷️ Barkod Etiket Yazdır</div>
          <div style={{ opacity: 0.7, marginTop: 4 }}>
            Bugün eklenenler veya seçtiğin ürünler için A4 etiket çıktısı al.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => load()}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(17,24,39,0.15)",
              background: "white",
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            Yenile
          </button>

          <button
            disabled={!canPrint || busyPdf}
            onClick={downloadPdf}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(17,24,39,0.15)",
              background: canPrint && !busyPdf ? "#111827" : "#e5e7eb",
              color: canPrint && !busyPdf ? "white" : "#6b7280",
              cursor: canPrint && !busyPdf ? "pointer" : "not-allowed",
              fontWeight: 800,
            }}
            title={!canPrint ? "Önce etiket oluştur" : "PDF indir"}
          >
            {busyPdf ? "PDF hazırlanıyor..." : "PDF İndir"}
          </button>
        </div>
      </div>

      {/* Controls */}
      <div
        style={{
          marginTop: 14,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 12,
        }}
      >
        {/* left */}
        <div style={{ border: "1px solid rgba(17,24,39,0.08)", borderRadius: 16, background: "white", padding: 12 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <button
              onClick={() => setTab("today")}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(17,24,39,0.12)",
                background: tab === "today" ? "#111827" : "white",
                color: tab === "today" ? "white" : "#111827",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Bugün Eklenenler
            </button>
            <button
              onClick={() => setTab("selected")}
              style={{
                padding: "8px 10px",
                borderRadius: 12,
                border: "1px solid rgba(17,24,39,0.12)",
                background: tab === "selected" ? "#111827" : "white",
                color: tab === "selected" ? "white" : "#111827",
                fontWeight: 800,
                cursor: "pointer",
              }}
            >
              Seçilen Ürünler
            </button>
          </div>

          {err && (
            <div style={{ color: "crimson", marginBottom: 8, whiteSpace: "pre-wrap" }}>
              {err}
            </div>
          )}

          {loading ? (
            <div style={{ opacity: 0.7 }}>Yükleniyor...</div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontWeight: 800, opacity: 0.85 }}>
                  {tab === "today" ? `Bugün eklenen: ${todayProducts.length}` : `Seçilen: ${selectedProducts.length}`}
                </div>

                {tab === "selected" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button
                      onClick={selectAllVisible}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(17,24,39,0.15)",
                        background: "white",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Hepsini Seç
                    </button>
                    <button
                      onClick={clearSelected}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid rgba(17,24,39,0.15)",
                        background: "white",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      Temizle
                    </button>
                  </div>
                )}
              </div>

              {/* list */}
              <div style={{ maxHeight: 320, overflow: "auto", borderRadius: 12, border: "1px solid rgba(17,24,39,0.08)" }}>
                <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0 }}>
                  <thead>
                    <tr style={{ background: "#f9fafb" }}>
                      {tab === "selected" && <th style={th}>Seç</th>}
                      <th style={th}>Barkod</th>
                      <th style={th}>Ürün</th>
                      <th style={th}>Fiyat</th>
                      <th style={th}>Adet (Etiket)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tab === "today" ? todayProducts : sortedProducts).map((p) => {
                      const checked = !!selected[p.barcode];
                      const st = productStock(p);
                      const disabledSelect = st <= 0;
                      const qty = qtyByBarcode[p.barcode] ?? 0;

                      // Bugün sekmesinde sadece bugün ürünleri göster
                      if (tab === "today" && !isCreatedToday(p)) return null;

                      return (
                        <tr key={p.barcode} style={{ borderTop: "1px solid rgba(17,24,39,0.06)" }}>
                          {tab === "selected" && (
                            <td style={tdCenter}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabledSelect}
                                title={disabledSelect ? "Stok 0 olduğu için seçilemez" : ""}
                                onChange={() => {
                                  if (disabledSelect) return;
                                  toggleSelect(p.barcode);
                                }}
                              />
                            </td>
                          )}
                          <td style={tdMono}>{p.barcode}</td>
                          <td style={td}>{p.name}</td>
                          <td style={td}>{fmtMoney(p.sell_price)}</td>
                          <td style={tdCenter}>
                            <input
                              type="number"
                              min={0}
                              max={st}
                              disabled={st <= 0}
                              value={qty}
                              onChange={(e) => {
                                const raw = Number(e.target.value);
                                const v = Number.isFinite(raw) ? raw : 0;
                                const clamped = Math.max(0, Math.min(st, Math.floor(v)));
                                setQtyByBarcode((prev) => ({
                                  ...prev,
                                  [p.barcode]: clamped,
                                }));
                              }}
                              style={{
                                width: 80,
                                padding: "6px 8px",
                                borderRadius: 10,
                                border: "1px solid rgba(17,24,39,0.15)",
                                textAlign: "center",
                                opacity: st <= 0 ? 0.5 : 1,
                              }}
                            />
                            <div style={{ fontSize: 11, opacity: 0.65, marginTop: 4 }}>
                              Stok: {st}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {tab === "today" && todayProducts.length === 0 && (
                <div style={{ marginTop: 10, opacity: 0.7 }}>
                </div>
              )}
            </>
          )}
        </div>

        {/* right */}
        <div style={{ border: "1px solid rgba(17,24,39,0.08)", borderRadius: 16, background: "white", padding: 12 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Etiket Ayarları</div>


          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10 }}>
            <Toggle label="Ürün Kodu" checked={showCode} onChange={setShowCode} />
            <Toggle label="Fiyat" checked={showPrice} onChange={setShowPrice} />
          </div>

          <div style={{ marginTop: 10, opacity: 0.75 }}>
            Oluşacak etiket sayısı: <b>{labels.length}</b>
          </div>

          <div style={{ marginTop: 10, borderTop: "1px solid rgba(17,24,39,0.08)", paddingTop: 10 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Önizleme / Yazdırma Alanı</div>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
              Yazdır dediğinde sadece bu alan (etiket sayfası) yazdırılır.
            </div>

            <BarcodeLabelSheet
              labels={labels}
              cols={PRESET.cols}
              gapMm={PRESET.gapMm}
              labelWidthMm={PRESET.labelW}
              labelHeightMm={PRESET.labelH}
              pagePaddingMm={PRESET.pagePaddingMm}
              showProductCode={showCode}
              showPrice={showPrice}
              showSizeColor={false}
            />
          </div>
        </div>
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
          background: "#111827",
          color: "white",
          fontWeight: 800,
          boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          maxWidth: 360,
          whiteSpace: "pre-wrap",
        }}
      >
        {toast}
      </div>
    )}
    </div>
  );
}

/* UI helpers */
const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 10px",
  fontSize: 12,
  fontWeight: 900,
  color: "#111827",
  borderBottom: "1px solid rgba(17,24,39,0.08)",
  position: "sticky",
  top: 0,
  background: "#f9fafb",
  zIndex: 1,
};

const td: React.CSSProperties = {
  padding: "10px 10px",
  fontSize: 13,
  color: "#111827",
  verticalAlign: "middle",
};

const tdMono: React.CSSProperties = {
  ...td,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  fontSize: 12,
};

const tdCenter: React.CSSProperties = {
  ...td,
  textAlign: "center",
};


function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 10px",
        borderRadius: 999,
        border: "1px solid rgba(17,24,39,0.12)",
        background: checked ? "rgba(17,24,39,0.06)" : "white",
        cursor: "pointer",
        userSelect: "none",
        fontWeight: 800,
        fontSize: 12,
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}