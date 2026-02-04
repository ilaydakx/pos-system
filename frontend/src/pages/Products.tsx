import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "react-router-dom";
import { confirm } from "@tauri-apps/plugin-dialog";

type Product = {
  barcode: string;
  product_code?: string | null;
  category?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  buy_price?: number | null;
  sell_price: number;

  stock?: number | null;

  magaza_stok?: number | null;
  depo_stok?: number | null;
  created_at?: string | null;
};

export function Products() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState("");
  const [showAll, setShowAll] = useState(false); 

  const getDisplayStock = (p: Product) => {
    const hasLoc = p.magaza_stok != null || p.depo_stok != null;
    return hasLoc
      ? (p.magaza_stok ?? 0) + (p.depo_stok ?? 0)
      : (p.stock ?? 0);
  };

  const load = async () => {
    try {
      setErr("");
      setLoading(true);

      const rows = await invoke<Product[]>("list_products");
      setProducts(rows);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();

    return products.filter((p) => {
      // 1) satışta olanlar filtresi
      if (!showAll) {
        const totalStock = getDisplayStock(p);
        if (totalStock <= 0) return false;
      }

      // 2) arama filtresi
      if (!t) return true;
      const hay = [
        p.barcode,
        p.product_code ?? "",
        p.name ?? "",
        p.category ?? "",
        p.color ?? "",
        p.size ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return hay.includes(t);
    });
  }, [products, q, showAll]);

  const rowBgByCode = useMemo(() => {
    const m = new Map<string, string>();
    const colors = ["#ffffff", "#FBF3EA"]; 
    let idx = 0;

    for (const p of filtered) {
      const code = (p.product_code ?? p.barcode).trim() || p.barcode;
      if (!m.has(code)) {
        m.set(code, colors[idx % 2]);
        idx += 1;
      }
    }

    return m;
  }, [filtered]);

  const getRowBg = (p: Product) => {
    const code = (p.product_code ?? p.barcode).trim() || p.barcode;
    return rowBgByCode.get(code) ?? "#ffffff";
  };

  // SİL HANDLER (DEBUG'lı)
  const handleDelete = async (barcode: string) => {
    console.log("delete click", barcode);
    console.log("delete handler fired");

    const ok = await confirm(`${barcode} barkodlu ürünü silmek istiyor musun?`, {
      title: "Ürün Sil",
      kind: "warning",
    });

    console.log("confirm result", ok);
    if (!ok) return;

    try {
      const affected = await invoke<number>("delete_product", { barcode: barcode.trim() });
      console.log("rows affected:", affected);

      setProducts(prev => prev.filter(p => p.barcode !== barcode));

    } catch (e) {
      console.error(e);
      setErr(String(e));
    }
  };

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Ürünler</h2>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <Link to="/products/new">
            <button>+ Ürün Ekle</button>
          </Link>

          <button onClick={load} disabled={loading}>
            Yenile
          </button>
        </div>
      </div>


      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <input
          placeholder="Ara: barkod / ürün kodu / kategori / isim / renk / beden"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, padding: 8 }}
        />
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <button
            onClick={() => setShowAll(false)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(17,24,39,0.15)",
              background: showAll ? "#fff" : "#111827",
              color: showAll ? "#111827" : "#fff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Satışta Olanlar
          </button>

          <button
            onClick={() => setShowAll(true)}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(17,24,39,0.15)",
              background: showAll ? "#111827" : "#fff",
              color: showAll ? "#fff" : "#111827",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Tüm Ürünler
          </button>
        </div>
        <div style={{ minWidth: 140, alignSelf: "center", opacity: 0.8 }}>
          {filtered.length} / {products.length}
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>
          ❌ {err}
        </div>
      )}

      {loading ? (
        <div style={{ marginTop: 16 }}>Yükleniyor...</div>
      ) : (
        <div style={{ marginTop: 16, overflow: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 1080,
            }}
          >
            <thead>
              <tr>
                {[
                  "Barkod",
                  "Ürün Kodu",
                  "Kategori",
                  "Ürün Adı",
                  "Renk",
                  "Beden",
                  "Alış ₺",
                  "Satış ₺",
                  "Stok",
                  "İşlemler",
                ].map((h) => (
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
              {filtered.map((p) => (
                <tr key={p.barcode} style={{ background: getRowBg(p) }}>
                  <td style={cell}>{p.barcode}</td>
                  <td style={cell}>{p.product_code ?? "-"}</td>
                  <td style={cell}>{p.category ?? "-"}</td>
                  <td style={cellStrong}>{p.name}</td>
                  <td style={cell}>{p.color ?? "-"}</td>
                  <td style={cell}>{p.size ?? "-"}</td>
                  <td style={cell}>{fmtMoney(p.buy_price)}</td>
                  <td style={cell}>{fmtMoney(p.sell_price)}</td>
                  <td style={cell}>{getDisplayStock(p)}</td>

                  <td style={actionsCell}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <Link
                        to={`/products/${encodeURIComponent(p.barcode)}/edit`}
                        style={btnLink}
                      >
                        Düzenle
                      </Link>

                      <Link
                        to={`/products/new?variantOf=${encodeURIComponent(
                          (p.product_code ?? p.barcode).trim() || p.barcode
                        )}&from=${encodeURIComponent(p.barcode)}`}
                        style={btnLink}
                      >
                        ➕ Yeni
                      </Link>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleDelete(p.barcode);
                        }}
                        style={{ cursor: "pointer", background: "white" }}
                      >
                        🗑 Sil
                      </button>
                    </div>
                  </td>
                </tr>
              ))}

              {filtered.length === 0 && (
                <tr>
                  <td style={{ padding: 12, opacity: 0.7 }} colSpan={10}>
                    Sonuç yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const cell: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f0f0f0",
  whiteSpace: "nowrap",
};

const cellStrong: React.CSSProperties = {
  ...cell,
  fontWeight: 600,
};

const btnLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 8px",
  borderRadius: 10,
  border: "1px solid rgba(17,24,39,0.15)",
  textDecoration: "none",
  color: "#111827",
  background: "#fff",
  fontSize: 12,
  fontWeight: 600,
};

const actionsCell: React.CSSProperties = {
  ...cell,
  whiteSpace: "nowrap",
};

function fmtMoney(v: number | null | undefined) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(v ?? 0);
}
