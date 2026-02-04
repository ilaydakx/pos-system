import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, useSearchParams } from "react-router-dom";

type VariantLine = {
  size: string;
  magaza: string; // input string
  depo: string; // input string
};
type CreatedProductDto = {
  barcode: string;
  product_code?: string | null;
};

function toName(x: any): string {
  if (x == null) return "";
  if (typeof x === "string") return x.trim();
  if (typeof x === "object") {
    
    if ("name" in x) return String((x as any).name ?? "").trim();
  }
  return String(x).trim();
}

async function safeList(
  cmd: "list_categories" | "list_colors" | "list_sizes",
): Promise<string[]> {
  try {
    const rows = await invoke<any[]>(cmd, { include_inactive: true });

    // aktif filtreyi de güvenli yap
    const names = (rows || [])
      .filter((r) => {
        // string gelirse aktif kabul et
        if (typeof r === "string") return true;
        // object ise is_active kontrol et
        if (r && typeof r === "object" && "is_active" in r) return Number((r as any).is_active) === 1;
        return true;
      })
      .map(toName)
      .filter(Boolean);

    return Array.from(new Set(names));
  } catch {
    return [];
  }
}

export function ProductNew() {
  const nav = useNavigate();

  const [sp] = useSearchParams();

  const variantOf = (
    sp.get("variantOf") ||
    sp.get("family") ||
    sp.get("product_code") ||
    sp.get("code") ||
    ""
  )
    .trim()
    .toUpperCase();

  const fromBarcode = (sp.get("from") || sp.get("from_barcode") || sp.get("barcode") || "").trim();

  const mode = (sp.get("mode") || "").toLowerCase();
  const isVariantMode = Boolean(variantOf) || mode === "variant" || mode === "variants";


 
  // form alanları
  const [productCode, setProductCode] = useState(""); 

  const [barcode, setBarcode] = useState("");

  // Tek ekranda çoklu beden+stok (varyant modu)
  const [variantLines, setVariantLines] = useState<VariantLine[]>([]);



  // Normal mod stok alanları
  const [size, setSize] = useState("");
  const [storeStart, setStoreStart] = useState(""); // mağaza başlangıç
  const [warehouseStart, setWarehouseStart] = useState(""); // depo başlangıç

  const [category, setCategory] = useState("");
  const [name, setName] = useState(""); 
  const [color, setColor] = useState("");
  const [buyPrice, setBuyPrice] = useState(""); 
  const [sellPrice, setSellPrice] = useState(""); 

  // dropdown data from DB
  const [categories, setCategories] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);

  const PRODUCT_CODE_REGEX = /^[A-Z0-9]{3}-?\d{3}$/;
  const [result, setResult] = useState("");

  useEffect(() => {
    (async () => {
      setCategories(await safeList("list_categories"));
      setColors(await safeList("list_colors"));
      setSizes(await safeList("list_sizes"));
    })();
  }, []);

  // initial load for dropdowns + variant mode prefills
  useEffect(() => {
    if (!isVariantMode) return;

    // Lock product code for the family
    if (variantOf) setProductCode(variantOf);

    // In variant mode, we will typically add size rows
    setBarcode("");
    setVariantLines([]);
    // keep base fields (category/name/color/prices) from the source product
    setSize("");
    setStoreStart("");
    setWarehouseStart("");

    (async () => {
      try {
        if (!fromBarcode) return;
        const p = await invoke<any>("find_product", { barcode: fromBarcode });
        if (!p) return;

        // Prefer variantOf, fallback to source product_code
        const pc = (variantOf || p.product_code || "").toString().trim().toUpperCase();
        if (pc) setProductCode(pc);

        if (p.category != null) setCategory(String(p.category));
        if (p.name != null) setName(String(p.name));
        if (p.color != null) setColor(String(p.color));

        // Prices: always prefill from base product
        if (p.sell_price != null) setSellPrice(String(p.sell_price));
        if (p.buy_price != null) setBuyPrice(String(p.buy_price));
      } catch {
        // ignore
      }
    })();
  }, [isVariantMode, variantOf, fromBarcode]);

  const addLine = () => {
    setVariantLines((prev) => [...prev, { size: "", magaza: "", depo: "" }]);
  };

  const removeLine = (idx: number) => {
    setVariantLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, patch: Partial<VariantLine>) => {
    setVariantLines((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const canSave = (() => {
    const hasName = !!name.trim();

    const sp = Number(sellPrice);
    const hasSellPrice = !!sellPrice.trim() && !Number.isNaN(sp);

    const codeOk = !productCode.trim() || PRODUCT_CODE_REGEX.test(productCode.trim());

    // Barcode validation only matters in normal mode (barcode field is optional)
    const bc = barcode.trim();
    const barcodeOk = !bc || /^\d+$/.test(bc);

    // --- Single (üstteki) ürün geçerli mi? ---
    const s = (size || "").trim();
    const ss = storeStart.trim() === "" ? 0 : Number(storeStart.trim());
    const ws = warehouseStart.trim() === "" ? 0 : Number(warehouseStart.trim());

    const singleNumbersOk =
      Number.isFinite(ss) &&
      Number.isFinite(ws) &&
      ss >= 0 &&
      ws >= 0 &&
      Number.isInteger(ss) &&
      Number.isInteger(ws);

    const singleHasAnyInput = Boolean(s || storeStart.trim() || warehouseStart.trim());
    // Tekli ürünü kaydedeceksek: beden zorunlu ve toplam stok 0'dan büyük olsun.
    const singleValid =
      singleHasAnyInput &&
      !!s &&
      singleNumbersOk &&
      (ss + ws) > 0;

    // --- Satır ekle (varyant satırları) geçerli mi? ---
    const cleaned = variantLines
      .map((r) => ({
        size: (r.size || "").trim(),
        magaza: (r.magaza || "").trim(),
        depo: (r.depo || "").trim(),
      }))
      .filter((r) => r.size || r.magaza || r.depo);

    let rowsValid = false;
    if (cleaned.length > 0) {
      const seen = new Set<string>();
      rowsValid = true;
      for (const r of cleaned) {
        if (!r.size) {
          rowsValid = false;
          break;
        }
        if (seen.has(r.size)) {
          rowsValid = false;
          break;
        }
        seen.add(r.size);

        const ms = r.magaza === "" ? 0 : Number(r.magaza);
        const ds = r.depo === "" ? 0 : Number(r.depo);
        if (!Number.isFinite(ms) || !Number.isInteger(ms) || ms < 0) {
          rowsValid = false;
          break;
        }
        if (!Number.isFinite(ds) || !Number.isInteger(ds) || ds < 0) {
          rowsValid = false;
          break;
        }
        // Mağaza veya depo dolu olması yeter: toplam > 0
        if (ms + ds <= 0) {
          rowsValid = false;
          break;
        }
      }
    }

    // Kaydet aktif olsun: (singleValid veya rowsValid) + temel alanlar doğru olsun
    return hasName && hasSellPrice && codeOk && barcodeOk && (singleValid || rowsValid);
  })();

  const handleSave = async () => {
    try {
      setResult("");

      if (!name.trim()) {
        setResult("❌ Ürün adı zorunlu");
        return;
      }

      // product code format validation (optional)
      if (productCode.trim()) {
        if (!PRODUCT_CODE_REGEX.test(productCode.trim())) {
          setResult("❌ Ürün kodu formatı geçersiz (örn: SWT-001)");
          return;
        }
      }

      const spNum = Number(sellPrice);
      if (!sellPrice.trim() || Number.isNaN(spNum)) {
        setResult("❌ Satış fiyatı zorunlu ve sayı olmalı");
        return;
      }

      const bp = buyPrice.trim() === "" ? null : Number(buyPrice.trim());
      if (bp !== null && Number.isNaN(bp)) {
        setResult("❌ Alış fiyatı sayı olmalı");
        return;
      }

      // Satır ekle satırları
      const cleaned = variantLines
        .map((r) => ({
          size: (r.size || "").trim(),
          magaza: (r.magaza || "").trim(),
          depo: (r.depo || "").trim(),
        }))
        .filter((r) => r.size || r.magaza || r.depo);

      // Tekli (üstteki) ürün girişleri
      const singleSize = (size || "").trim();
      const ss = storeStart.trim() === "" ? 0 : Number(storeStart.trim());
      const ws = warehouseStart.trim() === "" ? 0 : Number(warehouseStart.trim());
      const singleHasAnyInput = Boolean(singleSize || storeStart.trim() || warehouseStart.trim());

      const rowsRequested = cleaned.length > 0;
      const singleRequested = singleHasAnyInput;

      if (!rowsRequested && !singleRequested) {
        setResult("❌ Üstten ürün gir veya + Satır ekle ile en az 1 satır gir");
        return;
      }

      // Satır doğrulama (varsa)
      if (rowsRequested) {
        const seen = new Set<string>();
        for (const r of cleaned) {
          if (!r.size) {
            setResult("❌ Beden boş olamaz");
            return;
          }
          if (seen.has(r.size)) {
            setResult("❌ Aynı bedeni iki kez ekleyemezsin");
            return;
          }
          seen.add(r.size);

          const ms = r.magaza === "" ? 0 : Number(r.magaza);
          const ds = r.depo === "" ? 0 : Number(r.depo);

          if (!Number.isFinite(ms) || !Number.isInteger(ms) || ms < 0) {
            setResult("❌ Mağaza stok 0 ve üzeri tam sayı olmalı");
            return;
          }
          if (!Number.isFinite(ds) || !Number.isInteger(ds) || ds < 0) {
            setResult("❌ Depo stok 0 ve üzeri tam sayı olmalı");
            return;
          }
          if (ms + ds <= 0) {
            setResult("❌ Her satırda mağaza veya depo stok girilmeli (toplam > 0)");
            return;
          }
        }
      }

      // Tekli doğrulama (girildiyse)
      if (singleRequested) {
        if (!singleSize) {
          setResult("❌ Üstteki ürün için beden seçmelisin");
          return;
        }
        if (!Number.isFinite(ss) || !Number.isInteger(ss) || ss < 0) {
          setResult("❌ Mağaza başlangıç stok geçersiz (0 ve üzeri tam sayı)");
          return;
        }
        if (!Number.isFinite(ws) || !Number.isInteger(ws) || ws < 0) {
          setResult("❌ Depo başlangıç stok geçersiz (0 ve üzeri tam sayı)");
          return;
        }
        if (ss + ws <= 0) {
          setResult("❌ Üstteki ürün için mağaza veya depo stok girilmeli (toplam > 0)");
          return;
        }
      }

      setResult("Ekleniyor...");

      // Aile ürün kodu: kullanıcı girdiyse onu kullan, yoksa ilk eklemede DB üretir; onu öğrenip diğerlerine uygula.
      let familyCode =
        (isVariantMode ? (variantOf || productCode) : productCode).trim()
          ? (isVariantMode ? (variantOf || productCode) : productCode)
              .trim()
              .toUpperCase()
              .replaceAll("-", "")
          : "";

      let createdCount = 0;

      // 1) Önce üstteki tekli ürünü ekle (varsa)
      if (singleRequested) {
        const totalStart = ss + ws;

        const res = await invoke<CreatedProductDto>("add_product", {
          payload: {
            barcode: null, // auto barcode
            product_code: familyCode ? familyCode : null,
            category: category.trim() ? category.trim() : null,
            name: name.trim(),
            color: color.trim() ? color.trim() : null,
            size: singleSize,
            buy_price: bp,
            sell_price: spNum,
            stock: totalStart,
            magaza_baslangic: ss,
            depo_baslangic: ws,
          },
        });

        createdCount += 1;

        // familyCode boşsa DB üretmiş olabilir -> onu sabitle
        if (!familyCode) {
          const pc = (res?.product_code ?? "").toString().trim();
          if (pc) familyCode = pc.toUpperCase().replaceAll("-", "");
        }
      }

      // 2) Sonra satır ekle ile girilen ürünleri ekle (varsa)
      if (rowsRequested) {
        for (const r of cleaned) {
          const ms = r.magaza === "" ? 0 : Number(r.magaza);
          const ds = r.depo === "" ? 0 : Number(r.depo);
          const total = ms + ds;

          const res = await invoke<CreatedProductDto>("add_product", {
            payload: {
              barcode: null,
              product_code: familyCode ? familyCode : null,
              category: category.trim() ? category.trim() : null,
              name: name.trim(),
              color: color.trim() ? color.trim() : null,
              size: r.size,
              buy_price: bp,
              sell_price: spNum,
              stock: total,
              magaza_baslangic: ms,
              depo_baslangic: ds,
            },
          });

          createdCount += 1;

          // familyCode boşsa (tekli eklenmediyse) ilk satır DB üretmiş olabilir -> onu sabitle
          if (!familyCode) {
            const pc = (res?.product_code ?? "").toString().trim();
            if (pc) familyCode = pc.toUpperCase().replaceAll("-", "");
          }
        }
      }

      setResult(`✅ ${createdCount} ürün eklendi`);
      setTimeout(() => nav("/products"), 300);
      return;
    } catch (e) {
      setResult(`❌ ${String(e)}`);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.12)",
    outline: "none",
    fontSize: 14,
    height: 45,
    boxSizing: "border-box",
    width: "100%",
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    background: "white",
  };

  const rowStyle: React.CSSProperties = { display: "flex", gap: 10 };

  return (
    <>
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 style={{ margin: 0 }}>{isVariantMode ? "Varyant Ekle" : "Ürün Ekle"}</h2>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={() => nav("/products")}>← Ürünlere Dön</button>
          </div>
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 10, maxWidth: 560 }}>
          {/* Product code input: only show in normal mode */}
          {!isVariantMode && (
            <input
              style={inputStyle}
              placeholder="Ürün Kodu (opsiyonel) örn: SWT-001"
              value={productCode}
              onChange={(e) => setProductCode(e.target.value.toUpperCase())}
            />
          )}

          {/* Category: only normal mode */}
          {!isVariantMode && (
            <div style={rowStyle}>
              <select
                style={{ ...selectStyle, flex: 1 }}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">Kategori seç</option>
                {categories.map((c) => (
                  <option key={`cat:${c}`} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          )}

          <input
            style={inputStyle}
            placeholder="Ürün adı"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <div style={rowStyle}>
            <select
              style={{ ...selectStyle, flex: 1 }}
              value={color}
              onChange={(e) => setColor(e.target.value)}
            >
              <option value="">Renk seç</option>
              {colors.map((c) => (
                <option key={`color:${c}`} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <select
              style={{ ...selectStyle, flex: 1 }}
              value={size}
              onChange={(e) => setSize(e.target.value)}
            >
              <option value="">Beden seç</option>
              {sizes.map((s) => (
                <option key={`size:${s}`} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <input
              style={inputStyle}
              placeholder="Alış fiyatı (opsiyonel)"
              value={buyPrice}
              onChange={(e) => setBuyPrice(e.target.value)}
              inputMode="decimal"
            />
            <input
              style={inputStyle}
              placeholder="Satış fiyatı"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              inputMode="decimal"
            />
          </div>

          <div style={rowStyle}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Mağaza başlangıç stok (adet)"
              value={storeStart}
              onChange={(e) => setStoreStart(e.target.value)}
              inputMode="numeric"
            />
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Depo başlangıç stok (adet)"
              value={warehouseStart}
              onChange={(e) => setWarehouseStart(e.target.value)}
              inputMode="numeric"
            />
          </div>

          <div style={{ ...inputStyle, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ opacity: 0.8 }}>Toplam stok (başlangıç)</div>
            <div style={{ fontWeight: 700 }}>
              {(
                (storeStart.trim() === "" ? 0 : Number(storeStart)) +
                (warehouseStart.trim() === "" ? 0 : Number(warehouseStart))
              ) || 0}
            </div>
          </div>

        

          {/* Kaydet üstü: Satır ekle (Beden + Mağaza + Depo). Satır varsa tekli beden + tekli stok alanları kayıtta ignore edilir. */}
          <div style={{ display: "grid", gap: 10, marginTop: 6 }}>
            <button
              type="button"
              onClick={addLine}
              style={{ padding: "10px 12px", borderRadius: 10 }}
            >
              + Satır ekle
            </button>

            {variantLines.length > 0 && (
              <div style={{ display: "grid", gap: 8 }}>
                {variantLines.map((r, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <select
                      style={{ ...selectStyle, flex: 1 }}
                      value={r.size}
                      onChange={(e) => updateLine(idx, { size: e.target.value })}
                    >
                      <option value="">Beden seç</option>
                      {sizes.map((s) => (
                        <option key={`row:${idx}:${s}`} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>

                    <input
                      style={{ ...inputStyle, width: 160 }}
                      placeholder="Mağaza"
                      value={r.magaza}
                      onChange={(e) => updateLine(idx, { magaza: e.target.value })}
                      inputMode="numeric"
                    />

                    <input
                      style={{ ...inputStyle, width: 160 }}
                      placeholder="Depo"
                      value={r.depo}
                      onChange={(e) => updateLine(idx, { depo: e.target.value })}
                      inputMode="numeric"
                    />

                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      style={{ padding: "10px 12px", borderRadius: 10 }}
                      title="Satırı sil"
                    >
                      –
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={!canSave}
            style={{
              marginTop: 6,
              padding: "12px 14px",
              borderRadius: 12,
              border: "0",
              cursor: canSave ? "pointer" : "not-allowed",
              opacity: canSave ? 1 : 0.5,
              fontWeight: 600,
            }}
          >
            Kaydet
          </button>

          {result && <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{result}</div>}
        </div>
      </div>
    </>
  );
}