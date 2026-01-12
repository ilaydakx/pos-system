import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import {
  CATEGORY_OPTIONS,
  COLOR_OPTIONS,
  SIZE_OPTIONS,
} from "../constants/options";

export function ProductNew() {
  const nav = useNavigate();


  // form alanları
  const [productCode, setProductCode] = useState(""); 
  const [category, setCategory] = useState("");
  const [name, setName] = useState(""); 
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [buyPrice, setBuyPrice] = useState(""); 
  const [sellPrice, setSellPrice] = useState(""); 

  //  stok alanları (başlangıç)
  const [storeStart, setStoreStart] = useState(""); // mağaza başlangıç
  const [warehouseStart, setWarehouseStart] = useState(""); // depo başlangıç

  const PRODUCT_CODE_REGEX = /^[A-Z]{3}-\d{3}$/;
  const [result, setResult] = useState("");



  const canSave = useMemo(() => {
    const hasName = !!name.trim();

    const sp = Number(sellPrice);
    const hasSellPrice = !!sellPrice.trim() && !Number.isNaN(sp);

    const codeOk =
      !productCode.trim() || PRODUCT_CODE_REGEX.test(productCode.trim());

    const ss = storeStart.trim() === "" ? 0 : Number(storeStart.trim());
    const ws = warehouseStart.trim() === "" ? 0 : Number(warehouseStart.trim());

    const startsOk =
      Number.isFinite(ss) && Number.isFinite(ws) && ss >= 0 && ws >= 0 &&
      Number.isInteger(ss) && Number.isInteger(ws);

    return hasName && hasSellPrice && codeOk && startsOk;
  }, [name, sellPrice, productCode, storeStart, warehouseStart]);

  const handleSave = async () => {
    try {
      setResult("");

      if (!name.trim()) {
        setResult("❌ Ürün adı zorunlu");
        return;
      }

      if (productCode.trim()) {
        if (!PRODUCT_CODE_REGEX.test(productCode.trim())) {
          setResult("❌ Ürün kodu formatı geçersiz (örn: SWT-001)");
          return;
        }
      }

      const sp = Number(sellPrice);
      if (!sellPrice.trim() || Number.isNaN(sp)) {
        setResult("❌ Satış fiyatı zorunlu ve sayı olmalı");
        return;
      }

      const bp = buyPrice.trim() === "" ? null : Number(buyPrice.trim());
      if (bp !== null && Number.isNaN(bp)) {
        setResult("❌ Alış fiyatı sayı olmalı");
        return;
      }

      const ss = storeStart.trim() === "" ? 0 : Number(storeStart.trim());
      const ws = warehouseStart.trim() === "" ? 0 : Number(warehouseStart.trim());

      if (!Number.isFinite(ss) || !Number.isInteger(ss) || ss < 0) {
        setResult("❌ Mağaza başlangıç stok geçersiz (0 ve üzeri tam sayı)");
        return;
      }

      if (!Number.isFinite(ws) || !Number.isInteger(ws) || ws < 0) {
        setResult("❌ Depo başlangıç stok geçersiz (0 ve üzeri tam sayı)");
        return;
      }

      const totalStart = ss + ws;

      setResult("Ekleniyor...");

      const newBarcode = await invoke<string>("add_product", {
        payload: {
          barcode: "",
          product_code: productCode.trim() ? productCode.trim() : null,
          category: category.trim() ? category.trim() : null,
          name: name.trim(),
          color: color.trim() ? color.trim() : null,
          size: size.trim() ? size.trim() : null,
          buy_price: bp,
          sell_price: sp,

          stock: totalStart,

          magaza_baslangic: ss,
          depo_baslangic: ws,
          toplam_stok: totalStart,
          magaza_stok: ss,
          depo_stok: ws,
          toplam_kalan: totalStart,
        },
      });

      setResult(`✅ Eklendi. Barkod: ${newBarcode}`);

      setTimeout(() => nav("/products"), 300);
    } catch (e) {
      setResult(`❌ ${String(e)}`);
    }
  };

  const inputStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(0,0,0,0.12)",
    outline: "none",
    fontSize: 14,
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    background: "white",
  };

  const rowStyle: React.CSSProperties = { display: "flex", gap: 10 };

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Ürün Ekle</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={() => nav("/products")}>← Ürünlere Dön</button>
        </div>
      </div>


      <div style={{ marginTop: 16, display: "grid", gap: 10, maxWidth: 560 }}>
        <input
          style={inputStyle}
          placeholder="Ürün Kodu (opsiyonel) örn: SWT-001"
          value={productCode}
          onChange={(e) => setProductCode(e.target.value.toUpperCase())}
        />
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          Format: 3 harf + "-" + 3 rakam (SWT-001)
        </div>

        {/* Kategori dropdown */}
        <select
          style={selectStyle}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">Kategori seç (opsiyonel)</option>
          {CATEGORY_OPTIONS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <input
          style={inputStyle}
          placeholder="Ürün adı (zorunlu)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        {/* Renk + Beden dropdown */}
        <div style={rowStyle}>
          <select
            style={{ ...selectStyle, flex: 1 }}
            value={color}
            onChange={(e) => setColor(e.target.value)}
          >
            <option value="">Renk seç (opsiyonel)</option>
            {COLOR_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            style={{ ...selectStyle, flex: 1 }}
            value={size}
            onChange={(e) => setSize(e.target.value)}
          >
            <option value="">Beden seç (opsiyonel)</option>
            {SIZE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div style={rowStyle}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="Alış fiyatı ₺ (opsiyonel)"
            value={buyPrice}
            onChange={(e) => setBuyPrice(e.target.value)}
            inputMode="decimal"
          />
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="Satış fiyatı ₺ (zorunlu)"
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

        {result && (
          <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{result}</div>
        )}

      </div>
    </div>
  );
}