import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate, useParams } from "react-router-dom";

type Product = {
  barcode: string;
  product_code?: string | null;
  category?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  buy_price?: number | null;
  sell_price: number;
  created_at?: string | null;

  stock: number;
  magaza_baslangic: number;
  depo_baslangic: number;
  magaza_stok: number;
  depo_stok: number;
};

type DictItemDto = {
  id: number;
  name: string;
  is_active: number;
  created_at?: string | null;
  sort_order?: number | null;
};

type UpdateProductPayload = {
  barcode: string;
  product_code?: string | null;
  category?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  buy_price?: number | null;
  sell_price: number;
};

async function safeList(
  cmd: "list_categories" | "list_colors" | "list_sizes",
): Promise<string[]> {
  try {
    const rows = await invoke<DictItemDto[]>(cmd, { include_inactive: true });
    // only active items
    const names = (rows || [])
      .filter((r) => Number(r.is_active) === 1)
      .map((r) => String(r.name).trim())
      .filter(Boolean);
    return Array.from(new Set(names));
  } catch {
    return [];
  }
}

export default function ProductEdit() {
  const nav = useNavigate();
  const { barcode } = useParams<{ barcode: string }>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string>("");

  // dropdown lists (DB)
  const [categories, setCategories] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);

  // form
  const [productCode, setProductCode] = useState("");
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [color, setColor] = useState("");
  const [size, setSize] = useState("");
  const [buyPrice, setBuyPrice] = useState<string>("0");
  const [sellPrice, setSellPrice] = useState<string>("0");

  const bc = useMemo(() => decodeURIComponent(barcode ?? ""), [barcode]);

  const loadLists = async () => {
    setLoadingLists(true);
    try {
      const [c, co, s] = await Promise.all([
        safeList("list_categories"),
        safeList("list_colors"),
        safeList("list_sizes"),
      ]);
      setCategories(c);
      setColors(co);
      setSizes(s);
    } finally {
      setLoadingLists(false);
    }
  };
  const loadProduct = async () => {
    if (!bc) {
      setErr("Barkod bulunamadı.");
      setLoading(false);
      return;
    }

    try {
      setErr("");
      setLoading(true);

      // backend: find_product(barcode) -> Option<Product>
      const p = await invoke<Product | null>("find_product", { barcode: bc });
      if (!p) {
        setErr("Ürün bulunamadı.");
        return;
      }

      setProductCode(p.product_code ?? "");
      setCategory(p.category ?? "");
      setName(p.name ?? "");
      setColor(p.color ?? "");
      setSize(p.size ?? "");
      setBuyPrice(String(p.buy_price ?? 0));
      setSellPrice(String(p.sell_price ?? 0));
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // listeler + ürün aynı anda
    (async () => {
      await Promise.all([loadLists(), loadProduct()]);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bc]);

  const onSave = async () => {
    try {
      setErr("");
      setSaving(true);

      const sp = Number(sellPrice);
      const bp = buyPrice.trim() === "" ? null : Number(buyPrice);

      if (!name.trim()) throw new Error("Ürün adı zorunlu");
      if (!Number.isFinite(sp)) throw new Error("Satış fiyatı sayı olmalı");
      if (bp !== null && !Number.isFinite(bp)) throw new Error("Alış fiyatı sayı olmalı");

      const payload: UpdateProductPayload = {
        barcode: bc,
        product_code: productCode.trim() ? productCode.trim() : null,
        category: category.trim() ? category.trim() : null,
        name: name.trim(),
        color: color.trim() ? color.trim() : null,
        size: size.trim() ? size.trim() : null,
        buy_price: bp,
        sell_price: sp,
      };

      const changed = await invoke<number>("update_product", { payload });
      if (changed <= 0) {
        throw new Error("Güncelleme yapılamadı.");
      }

      nav("/products");
    } catch (e) {
      setErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  const selectWrap: React.CSSProperties = { display: "grid", gap: 6 };
  const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "center" };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "10px 14px",
    boxSizing: "border-box",
    height: 40,
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    background: "#fff",
    fontSize: 14,
    outline: "none",
  };
  const label: React.CSSProperties = { fontWeight: 700, color: "#111827" };
  const plusBtn: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 800,
  };

  if (loading) {
    return <div style={{ padding: 16 }}>Yükleniyor…</div>;
  }

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
        <div>
          <h2 style={{ margin: 0 }}>Ürün Düzenle</h2>
          <div style={{ opacity: 0.7, marginTop: 4 }}>Barkod: {bc}</div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => nav("/products")}
            style={{ ...plusBtn, fontWeight: 700 }}
            type="button"
          >
            Geri
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            style={{
              ...plusBtn,
              background: "#111827",
              color: "#fff",
              border: "1px solid #111827",
              opacity: saving ? 0.7 : 1,
            }}
            type="button"
          >
            {saving ? "Kaydediliyor…" : "Kaydet"}
          </button>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, padding: 12, borderRadius: 12, background: "#fee2e2", color: "#991b1b" }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
        <div style={selectWrap}>
          <div style={label}>Ürün Kodu (Aile)</div>
          <input style={input} value={productCode} onChange={(e) => setProductCode(e.target.value)} />
        </div>

        <div style={selectWrap}>
          <div style={label}>Ürün Adı</div>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div style={selectWrap}>
          <div style={label}>Kategori</div>
          <div style={row}>
            <select
              style={input}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={loadingLists}
            >
              <option value="">Seç…</option>
              {categories.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          {!loadingLists && categories.length === 0 && (
            <div style={{ opacity: 0.7, fontSize: 12 }}>Liste boş, + ile ekleyebilirsin.</div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={selectWrap}>
            <div style={label}>Renk</div>
            <div style={row}>
              <select
                style={input}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                disabled={loadingLists}
              >
                <option value="">Seç…</option>
                {colors.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={selectWrap}>
            <div style={label}>Beden</div>
            <div style={row}>
              <select
                style={input}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                disabled={loadingLists}
              >
                <option value="">Seç…</option>
                {sizes.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={selectWrap}>
            <div style={label}>Alış Fiyatı</div>
            <input style={input} value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} />
          </div>
          <div style={selectWrap}>
            <div style={label}>Satış Fiyatı</div>
            <input style={input} value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}