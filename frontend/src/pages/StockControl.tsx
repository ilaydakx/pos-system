import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";


type Product = {
  barcode: string;
  product_code?: string | null;
  category?: string | null;
  name: string;
  color?: string | null;
  size?: string | null;
  sell_price?: number | null;

  stock?: number | null;

  // ProductNew ile doldurulacak yeni alanlar
  magaza_baslangic?: number | null;
  depo_baslangic?: number | null;
  toplam_stok?: number | null; 

  magaza_stok?: number | null;
  depo_stok?: number | null;
  toplam_kalan?: number | null; 
};

type RowStatus = {
  mismatch_kalan: boolean; 
  mismatch_baslangic: boolean; 
  negative: boolean; 
  out_of_stock: boolean; 
  only_store: boolean; 
  only_warehouse: boolean; 
};

export function StockControl() {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [rows, setRows] = useState<Product[]>([]);
  const [q, setQ] = useState("");

  // filtreler
  const [fMismatch, setFMismatch] = useState(false);
  const [fOut, setFOut] = useState(false);
  const [fOnlyStore, setFOnlyStore] = useState(false);
  const [fOnlyWarehouse, setFOnlyWarehouse] = useState(false);

  const load = async () => {
    try {
      setErr("");
      setLoading(true);
      const list = await invoke<Product[]>("list_products");
      setRows(list);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, []);
  

  const computed = useMemo(() => {
    const t = q.trim().toLowerCase();

    const mapped = rows.map((p) => {
      const legacyStock =
        (p.magaza_stok == null && p.depo_stok == null) && p.stock != null;

      const legacy = asInt(p.stock);

      const magaza_stok = legacyStock ? legacy : asInt(p.magaza_stok);
      const depo_stok = legacyStock ? 0 : asInt(p.depo_stok);
      const toplam_kalan_db = asInt(p.toplam_kalan);

      const magaza_baslangic = legacyStock ? legacy : asInt(p.magaza_baslangic);
      const depo_baslangic = legacyStock ? 0 : asInt(p.depo_baslangic);
      const toplam_stok_db = asInt(p.toplam_stok);

      const toplam_kalan_calc = magaza_stok + depo_stok;
      const toplam_stok_calc = magaza_baslangic + depo_baslangic;

      
      const mismatch_kalan =
        p.toplam_kalan != null && toplam_kalan_db !== toplam_kalan_calc;
      const mismatch_baslangic =
        p.toplam_stok != null && toplam_stok_db !== toplam_stok_calc;

      const negative =
        magaza_stok < 0 ||
        depo_stok < 0 ||
        (p.toplam_kalan != null && toplam_kalan_db < 0);

      const out_of_stock = toplam_kalan_calc === 0;
      const only_store = magaza_stok > 0 && depo_stok === 0;
      const only_warehouse = depo_stok > 0 && magaza_stok === 0;

      const status: RowStatus = {
        mismatch_kalan,
        mismatch_baslangic,
        negative,
        out_of_stock,
        only_store,
        only_warehouse,
      };

      const hay = [
        p.barcode,
        p.product_code ?? "",
        p.category ?? "",
        p.name ?? "",
        p.color ?? "",
        p.size ?? "",
      ]
        .join(" ")
        .toLowerCase();

      const passSearch = !t || hay.includes(t);
      const passMismatch =
        !fMismatch || mismatch_kalan || mismatch_baslangic || negative;
      const passOut = !fOut || out_of_stock;
      const passOnlyStore = !fOnlyStore || only_store;
      const passOnlyWarehouse = !fOnlyWarehouse || only_warehouse;

      const pass =
        passSearch && passMismatch && passOut && passOnlyStore && passOnlyWarehouse;

      return {
        p,
        status,
        toplam_kalan_calc,
        toplam_stok_calc,
        pass,
        legacyStock,
      };
    });

    const visible = mapped.filter((x) => x.pass);

    const counts = {
      total: rows.length,
      visible: visible.length,
      mismatch: mapped.filter(
        (x) =>
          x.status.mismatch_kalan ||
          x.status.mismatch_baslangic ||
          x.status.negative
      ).length,
      out: mapped.filter((x) => x.status.out_of_stock).length,
      onlyStore: mapped.filter((x) => x.status.only_store).length,
      onlyWarehouse: mapped.filter((x) => x.status.only_warehouse).length,
    };

    return { mapped, visible, counts };
  }, [rows, q, fMismatch, fOut, fOnlyStore, fOnlyWarehouse]);

  return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Stok Kontrol</h2>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button type="button" onClick={load} disabled={loading}>
            Yenile
          </button>
        </div>
      </div>


      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <input
          placeholder="Ara: barkod / ürün kodu / kategori / isim / renk / beden"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1, minWidth: 320, padding: 8 }}
        />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <label style={chip}>
            <input
              type="checkbox"
              checked={fMismatch}
              onChange={(e) => setFMismatch(e.target.checked)}
            />
            Uyumsuz ({computed.counts.mismatch})
          </label>

          <label style={chip}>
            <input
              type="checkbox"
              checked={fOut}
              onChange={(e) => setFOut(e.target.checked)}
            />
            Stok 0 ({computed.counts.out})
          </label>

          <label style={chip}>
            <input
              type="checkbox"
              checked={fOnlyStore}
              onChange={(e) => setFOnlyStore(e.target.checked)}
            />
            Sadece Mağaza ({computed.counts.onlyStore})
          </label>

          <label style={chip}>
            <input
              type="checkbox"
              checked={fOnlyWarehouse}
              onChange={(e) => setFOnlyWarehouse(e.target.checked)}
            />
            Sadece Depo ({computed.counts.onlyWarehouse})
          </label>
        </div>

        <div style={{ minWidth: 140, alignSelf: "center", opacity: 0.8 }}>
          {computed.counts.visible} / {computed.counts.total}
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
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1400 }}>
            <thead>
              <tr>
                {[
                  "Durum",
                  "Barkod",
                  "Ürün Kodu",
                  "Kategori",
                  "Ürün Adı",
                  "Renk",
                  "Beden",
                  "Satış Fiyatı",
                  "Mağaza Stok",
                  "Depo Stok",
                  "Toplam Kalan",
                  "Toplam Stok",
                  "Mağaza Başlangıç",
                  "Depo Başlangıç",
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
                      zIndex: 1,
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {computed.visible.map(({ p, status, toplam_kalan_calc, toplam_stok_calc, legacyStock }) => {
                const rowStyle = getRowStyle(status);

                const magaza_stok = asInt(p.magaza_stok);
                const depo_stok = asInt(p.depo_stok);
                const toplam_kalan_db = asInt(p.toplam_kalan);

                const magaza_baslangic = asInt(p.magaza_baslangic);
                const depo_baslangic = asInt(p.depo_baslangic);
                const toplam_stok_db = asInt(p.toplam_stok);

                const toplam_kalan_show =
                  p.toplam_kalan == null ? toplam_kalan_calc : toplam_kalan_db;
                const toplam_stok_show =
                  p.toplam_stok == null ? toplam_stok_calc : toplam_stok_db;

                return (
                  <tr key={p.barcode} style={rowStyle.tr}>
                    <td style={{ ...cell, ...rowStyle.cell }}>
                      {renderStatus(status)}
                      {legacyStock && (
                        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                          (Eski stok alanı)
                        </div>
                      )}
                      {(status.mismatch_kalan || status.mismatch_baslangic || status.negative) && (
                        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
                          {status.negative ? "Eksi stok" : ""}
                          {status.negative && (status.mismatch_kalan || status.mismatch_baslangic)
                            ? " • "
                            : ""}
                          {status.mismatch_kalan ? "Kalan uyumsuz" : ""}
                          {status.mismatch_kalan && status.mismatch_baslangic ? " • " : ""}
                          {status.mismatch_baslangic ? "Başlangıç uyumsuz" : ""}
                        </div>
                      )}
                    </td>

                    <td style={{ ...cell, ...rowStyle.cell }}>{p.barcode}</td>
                    <td style={{ ...cell, ...rowStyle.cell }}>{p.product_code ?? "-"}</td>
                    <td style={{ ...cell, ...rowStyle.cell }}>{p.category ?? "-"}</td>
                    <td style={{ ...cellStrong, ...rowStyle.cell }}>{p.name}</td>
                    <td style={{ ...cell, ...rowStyle.cell }}>{p.color ?? "-"}</td>
                    <td style={{ ...cell, ...rowStyle.cell }}>{p.size ?? "-"}</td>
                    <td style={{ ...cell, ...rowStyle.cell }}>{fmtMoney(asNum(p.sell_price))}</td>

                    <td style={{ ...cell, ...rowStyle.cell }}>{magaza_stok}</td>
                    <td style={{ ...cell, ...rowStyle.cell }}>{depo_stok}</td>

                    <td style={{ ...cellStrong, ...rowStyle.cell }}>
                      {toplam_kalan_show}
                      {p.toplam_kalan != null && toplam_kalan_db !== toplam_kalan_calc && (
                        <div style={{ fontSize: 12, opacity: 0.85 }}>Hesap: {toplam_kalan_calc}</div>
                      )}
                    </td>

                    <td style={{ ...cell, ...rowStyle.cell }}>
                      {toplam_stok_show}
                      {p.toplam_stok != null && toplam_stok_db !== toplam_stok_calc && (
                        <div style={{ fontSize: 12, opacity: 0.85 }}>Hesap: {toplam_stok_calc}</div>
                      )}
                    </td>

                    <td style={{ ...cell, ...rowStyle.cell }}>{magaza_baslangic}</td>
                    <td style={{ ...cell, ...rowStyle.cell }}>{depo_baslangic}</td>
                  </tr>
                );
              })}

              {computed.visible.length === 0 && (
                <tr>
                  <td style={{ padding: 12, opacity: 0.7 }} colSpan={14}>
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

const chip: React.CSSProperties = {
  border: "1px solid #e6e6e6",
  borderRadius: 999,
  padding: "6px 10px",
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  background: "white",
};

const cell: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid #f0f0f0",
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

const cellStrong: React.CSSProperties = {
  ...cell,
  fontWeight: 700,
};

function asInt(v: unknown): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function asNum(v: unknown): number {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function fmtMoney(v: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 2,
  }).format(v ?? 0);
}

function renderStatus(s: RowStatus) {
  if (s.negative) return <span style={badge("error")}>HATA</span>;
  if (s.mismatch_kalan || s.mismatch_baslangic) return <span style={badge("warn")}>UYUMSUZ</span>;
  if (s.out_of_stock) return <span style={badge("danger")}>STOK 0</span>;
  return <span style={badge("ok")}>OK</span>;
}

function badge(_kind: "ok" | "warn" | "danger" | "error"): React.CSSProperties {
  return {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid #e6e6e6",
    background: "white",
  };
}

function getRowStyle(s: RowStatus): { tr: React.CSSProperties; cell: React.CSSProperties } {
  if (s.negative) return { tr: { background: "#fff2f2" }, cell: {} };
  if (s.mismatch_kalan || s.mismatch_baslangic) return { tr: { background: "#fff7e6" }, cell: {} };
  if (s.out_of_stock) return { tr: { background: "#fff2f2" }, cell: {} };
  return { tr: {}, cell: {} };
}
