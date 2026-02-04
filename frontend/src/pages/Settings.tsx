import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";


const LS_LAST_BACKUP_PATH = "cielpos_last_backup_path";
const LS_LAST_BACKUP_AT = "cielpos_last_backup_at";

type DictItemDto = {
  id: number;
  name: string;
  is_active: number;
  created_at?: string | null;
  sort_order?: number | null;
};
type DictKind = "CATEGORY" | "COLOR" | "SIZE";


function toActiveNames(rows: DictItemDto[]): string[] {
  return (rows || [])
    .filter((r) => Number(r.is_active) === 1)
    .map((r) => String(r.name).trim())
    .filter(Boolean);
}

function nowLocalLabel() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
}

function dirOf(p: string): string {
  const t = (p || "").trim();
  if (!t) return "";
  // support both mac/linux and windows separators
  const s = t.replace(/\\/g, "/");
  const idx = s.lastIndexOf("/");
  if (idx <= 0) return "";
  return s.slice(0, idx);
}
type RestoreFromBackupPayload = {
  backup_path: string;
  products: boolean;
  sales: boolean;
  returns: boolean;
  transfers: boolean;
  expenses: boolean;
};
type RestoreFromBackupResult = {
  restored_db_path: string;
  used_backup_path: string;
  safety_backup_path: string;
};

const styles = {
  page: { maxWidth: 920, margin: "0 auto", padding: "18px 16px 28px" },
  headerRow: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  brand: { fontSize: 12, opacity: 0.65 },
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  card: {
    border: "1px solid rgba(17,24,39,0.08)",
    borderRadius: 16,
    padding: 16,
    background: "white",
    boxShadow: "0 6px 18px rgba(0,0,0,0.04)",
  },
  cardTitle: { fontWeight: 800, margin: 0, marginBottom: 10 },
  subText: { fontSize: 13, opacity: 0.75, lineHeight: 1.5 },
  monoBox: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
    padding: 10,
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.10)",
    background: "#fafafa",
    wordBreak: "break-all" as const,
  },
  row: { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const },
  btn: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 600,
  },
  btnPrimary: (enabled: boolean) => ({
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    background: enabled ? "#111827" : "#e5e7eb",
    color: enabled ? "white" : "#6b7280",
    cursor: enabled ? "pointer" : "not-allowed",
    fontWeight: 800,
  }),
  btnDark: (enabled: boolean) => ({
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #111",
    background: enabled ? "#111" : "#eee",
    color: enabled ? "white" : "#555",
    cursor: enabled ? "pointer" : "not-allowed",
    fontWeight: 800,
  }),
  divider: { height: 1, background: "rgba(17,24,39,0.08)", margin: "12px 0" },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 999,
    border: "1px solid rgba(17,24,39,0.10)",
    background: "#fafafa",
    fontSize: 12,
    opacity: 0.85,
  },
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(17,24,39,0.12)",
    background: "#fff",
    fontSize: 13,
  },
  input: {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(17,24,39,0.15)",
    background: "#fff",
    outline: "none",
  },
  miniTitle: { fontWeight: 800, margin: 0, marginBottom: 8 },
  helper: { fontSize: 12, opacity: 0.7, lineHeight: 1.4 },
  sectionHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
  listWrap: { display: "flex", flexWrap: "wrap" as const, gap: 8 },
  btnSmall: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(17,24,39,0.15)",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: 12,
  },
  btnDangerSmall: {
    padding: "6px 10px",
    borderRadius: 10,
    border: "1px solid rgba(220,38,38,0.25)",
    background: "#fff",
    color: "#b91c1c",
    cursor: "pointer",
    fontWeight: 800,
    fontSize: 12,
  },
};

export default function Settings() {
  const [busy, setBusy] = useState(false);
  const [lastPath, setLastPath] = useState<string>("");
  const [lastAt, setLastAt] = useState<string>("");
  const [backupDir, setBackupDir] = useState<string>("");
  const [err, setErr] = useState<string>("");
  const [backupFile, setBackupFile] = useState<string>("");
  const [products, setProducts] = useState(true);
  const [sales, setSales] = useState(true);
  const [returns, setReturns] = useState(true);
  const [transfers, setTransfers] = useState(true);
  const [expenses, setExpenses] = useState(true);
  const [restoring, setRestoring] = useState(false);
  const [restoreMsg, setRestoreMsg] = useState("");

  // --- Sözlükler (Kategori / Renk / Beden)
  const [cats, setCats] = useState<string[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [dictErr, setDictErr] = useState<string>("");
  const [dictBusy, setDictBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editKind, setEditKind] = useState<DictKind>("CATEGORY");
  const [editRows, setEditRows] = useState<DictItemDto[]>([]);
  const [editErr, setEditErr] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  const [newCat, setNewCat] = useState("");
  const [newColor, setNewColor] = useState("");
  const [newSize, setNewSize] = useState("");

  useEffect(() => {
    setLastPath(localStorage.getItem(LS_LAST_BACKUP_PATH) || "");
    setLastAt(localStorage.getItem(LS_LAST_BACKUP_AT) || "");
    (async () => {
      try {
        setErr("");
        const p = await invoke<string>("get_backup_dir");
        setBackupDir(p);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  const loadDictionaries = useCallback(async () => {
    try {
      setDictErr("");
      const [c1, c2, c3] = await Promise.all([
        invoke<DictItemDto[]>("list_categories", { include_inactive: true }),
        invoke<DictItemDto[]>("list_colors", { include_inactive: true }),
        invoke<DictItemDto[]>("list_sizes", { include_inactive: true }),
      ]);
      setCats(toActiveNames(c1));
      setColors(toActiveNames(c2));
      setSizes(toActiveNames(c3));
    } catch (e) {
      setDictErr(String(e));
    }
  }, []);

  useEffect(() => {
    loadDictionaries();
  }, [loadDictionaries]);

  async function addCat() {
    const name = newCat.trim();
    if (!name) return;
    try {
      setDictBusy(true);
      await invoke("create_category", { name });
      setNewCat("");
      await loadDictionaries();
    } catch (e) {
      alert("❌ Kategori eklenemedi: " + String(e));
    } finally {
      setDictBusy(false);
    }
  }

  async function addColorRow() {
    const name = newColor.trim();
    if (!name) return;
    try {
      setDictBusy(true);
      await invoke("create_color", { name });
      setNewColor("");
      await loadDictionaries();
    } catch (e) {
      alert("❌ Renk eklenemedi: " + String(e));
    } finally {
      setDictBusy(false);
    }
  }

  async function addSizeRow() {
    const name = newSize.trim();
    if (!name) return;
    try {
      setDictBusy(true);
      await invoke("create_size", { name, sort_order: null });
      setNewSize("");
      await loadDictionaries();
    } catch (e) {
      alert("❌ Beden eklenemedi: " + String(e));
    } finally {
      setDictBusy(false);
    }
  }

  const handleBackup = async () => {
    try {
      setBusy(true);
      const path = await invoke<string>("backup_now");

      const at = nowLocalLabel();
      localStorage.setItem(LS_LAST_BACKUP_PATH, path);
      localStorage.setItem(LS_LAST_BACKUP_AT, at);

      setLastPath(path);
      setLastAt(at);

      alert("✅ Yedek alındı:\n" + path);
    } catch (e) {
      alert("❌ Yedek alınamadı: " + String(e));
    } finally {
      setBusy(false);
    }
  };
  const openBackups = async () => {
    try {
      await invoke("open_backup_folder");
    } catch (e) {
      alert("❌ Backup klasörü açılamadı: " + String(e));
    }
  };

  const handleClear = () => {
    localStorage.removeItem(LS_LAST_BACKUP_PATH);
    localStorage.removeItem(LS_LAST_BACKUP_AT);
    setLastPath("");
    setLastAt("");
  };
  const openEdit = async (kind: DictKind) => {
    setEditErr("");
    setEditKind(kind);
    setEditOpen(true);
    setEditLoading(true);
    try {
      if (kind === "CATEGORY") {
        const rows = await invoke<DictItemDto[]>("list_categories", { include_inactive: true });
        setEditRows(rows);
      } else if (kind === "COLOR") {
        const rows = await invoke<DictItemDto[]>("list_colors", { include_inactive: true });
        setEditRows(rows);
      } else {
        const rows = await invoke<DictItemDto[]>("list_sizes", { include_inactive: true });
        setEditRows(rows);
      }
    } catch (e) {
      setEditErr(String(e));
    } finally {
      setEditLoading(false);
    }
  };

  const refreshAfterEdit = async () => {
    await openEdit(editKind);
    await loadDictionaries();
  };

  const removeOrDeactivate = async (row: DictItemDto) => {
    setEditErr("");
    try {
      if (editKind === "CATEGORY") await invoke<number>("delete_category", { id: row.id });
      else if (editKind === "COLOR") await invoke<number>("delete_color", { id: row.id });
      else await invoke<number>("delete_size", { id: row.id });

      await refreshAfterEdit();
    } catch (e) {
      setEditErr(String(e));
    }
  };

  const renameRow = async (row: DictItemDto, newName: string) => {
    const t = newName.trim();
    if (!t) return;

    setEditErr("");
    try {
      if (editKind === "CATEGORY") await invoke<number>("update_category", { id: row.id, name: t, is_active: null });
      else if (editKind === "COLOR") await invoke<number>("update_color", { id: row.id, name: t, is_active: null });
      else await invoke<number>("update_size", { id: row.id, name: t, sort_order: null, is_active: null });

      await refreshAfterEdit();
    } catch (e) {
      setEditErr(String(e));
    }
  };

  const activateRow = async (row: DictItemDto) => {
    setEditErr("");
    try {
      if (editKind === "CATEGORY") await invoke<number>("update_category", { id: row.id, name: null, is_active: 1 });
      else if (editKind === "COLOR") await invoke<number>("update_color", { id: row.id, name: null, is_active: 1 });
      else await invoke<number>("update_size", { id: row.id, name: null, sort_order: null, is_active: 1 });

      await refreshAfterEdit();
    } catch (e) {
      setEditErr(String(e));
    }
  };

  const canRestore = useMemo(() => {
    if (!backupFile) return false;
    return products || sales || returns || transfers || expenses;
  }, [backupFile, products, sales, returns, transfers, expenses]);

  async function pickBackup() {
    setRestoreMsg("");
    const preferredDir = dirOf(lastPath) || backupDir || "";
    const f = await open({
      title: "Yedek seç (.sqlite)",
      multiple: false,
      defaultPath: preferredDir || undefined,
      filters: [{ name: "SQLite", extensions: ["sqlite", "db"] }],
    });

    if (typeof f === "string") {
      setBackupFile(f);
    }
  }

  async function doRestore() {
    if (!canRestore) return;
    setRestoring(true);
    setRestoreMsg("");

    try {
      const payload: RestoreFromBackupPayload = {
        backup_path: backupFile,
        products,
        sales,
        returns,
        transfers,
        expenses,
      };

      const res = await invoke<RestoreFromBackupResult>("restore_from_backup", { payload });

      setRestoreMsg(
        "✅ Geri yüklendi.\n" +
          "DB: " +
          res.restored_db_path +
          "\n" +
          "Backup: " +
          res.used_backup_path +
          "\n" +
          "Güvenlik yedeği: " +
          res.safety_backup_path +
          "\n\n" +
          "⚠️ Not: Uygulamayı kapatıp açman gerekebilir."
      );
    } catch (e) {
      setRestoreMsg("❌ Hata: " + String(e));
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerRow}>
        <h2 style={{ margin: 0 }}>Ayarlar</h2>
        <div style={styles.brand}>CIEL POS</div>
      </div>

      {/* Yedekleme */}
<div style={{ marginTop: 14, ...styles.card }}>
  <h4 style={styles.cardTitle}>💾 Yedekleme</h4>
  <div style={styles.subText}>
    • Uygulama kapanırken otomatik yedek alır. <br />
    • Ekstra güvenlik için gün sonunda manuel yedek alabilirsin.
  </div>

  <div style={styles.divider} />

  <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
    <div style={{ border: "1px solid rgba(17,24,39,0.06)", borderRadius: 12, padding: 12, background: "#fafafa" }}>
      <div style={{ fontSize: 12, opacity: 0.65, marginBottom: 6 }}>Son Yedek</div>
      {lastAt || lastPath ? (
        <>
          <div style={{ fontWeight: 800 }}>{lastAt || "-"}</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4, wordBreak: "break-all" }}>{lastPath || "-"}</div>
        </>
      ) : (
        <div style={{ opacity: 0.7 }}>Henüz alınmadı.</div>
      )}
    </div>

    <div style={styles.row}>
      <button onClick={handleBackup} disabled={busy} style={styles.btnDark(!busy)}>
        {busy ? "Yedekleniyor..." : "Şimdi Yedekle"}
      </button>

      <button onClick={openBackups} style={styles.btn}>
        📁 Backup klasörünü aç
      </button>

      <button
        onClick={handleClear}
        disabled={busy}
        style={{ ...styles.btn, opacity: busy ? 0.6 : 1, cursor: busy ? "not-allowed" : "pointer" }}
        title="Ekrandaki 'Son Yedek' bilgisini temizler (yedek dosyalarını silmez)."
      >
        Son Yedek Bilgisini Temizle
      </button>
    </div>
  </div>
</div>

{/* Yedek Konumu */}
<div style={{ marginTop: 14, ...styles.card }}>
  <h4 style={styles.cardTitle}>📍 Yedek Konumu</h4>
  {err ? (
    <div style={{ color: "crimson" }}>❌ {err}</div>
  ) : (
    <div style={styles.monoBox}>{backupDir || "…"}</div>
  )}
</div>

      {/* Sözlükler (Kategori / Renk / Beden) */}
      <div style={{ marginTop: 14, ...styles.card }}>
        <div style={styles.sectionHeader}>
          <h4 style={styles.cardTitle}>🧩 Sözlükler (Kategori / Renk / Beden)</h4>
          <button
            onClick={loadDictionaries}
            disabled={dictBusy}
            style={{ ...styles.btnSmall, opacity: dictBusy ? 0.6 : 1 }}
            title="Listeyi yenile"
          >
            Yenile
          </button>
        </div>


        {dictErr ? (
          <div style={{ marginTop: 10, color: "crimson" }}>❌ {dictErr}</div>
        ) : null}

        <div style={styles.divider} />

        <div style={styles.grid2}>
          {/* Categories */}
          <div style={{ ...styles.card, boxShadow: "none" }}>
            <h5 style={styles.miniTitle}>Kategoriler</h5>

            <div style={{ ...styles.row, marginTop: 10 }}>
              <input
                value={newCat}
                onChange={(e) => setNewCat(e.target.value)}
                placeholder="Kategori adı"
                style={{ ...styles.input, flex: 1, minWidth: 180 }}
              />
              <button onClick={addCat} disabled={dictBusy} style={styles.btnPrimary(!dictBusy)}>
                + Ekle
              </button>
            </div>

            <div style={{ marginTop: 12, ...styles.listWrap }}>
              {(cats || []).map((x) => (
                <span key={x} style={styles.pill}>
                  {x}
                </span>
              ))}
              {!cats?.length ? <span style={{ opacity: 0.7 }}>Henüz yok</span> : null}
            </div>
          </div>

          {/* Colors */}
          <div style={{ ...styles.card, boxShadow: "none" }}>
            <h5 style={styles.miniTitle}>Renkler</h5>

            <div style={{ ...styles.row, marginTop: 10 }}>
              <input
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                placeholder="Renk adı"
                style={{ ...styles.input, flex: 1, minWidth: 180 }}
              />
              <button onClick={addColorRow} disabled={dictBusy} style={styles.btnPrimary(!dictBusy)}>
                + Ekle
              </button>
            </div>

            <div style={{ marginTop: 12, ...styles.listWrap }}>
              {(colors || []).map((x) => (
                <span key={x} style={styles.pill}>
                  {x}
                </span>
              ))}
              {!colors?.length ? <span style={{ opacity: 0.7 }}>Henüz yok</span> : null}
            </div>
          </div>

          {/* Sizes */}
          <div style={{ ...styles.card, boxShadow: "none" }}>
            <h5 style={styles.miniTitle}>Bedenler</h5>

            <div style={{ ...styles.row, marginTop: 10 }}>
              <input
                value={newSize}
                onChange={(e) => setNewSize(e.target.value)}
                placeholder="Beden"
                style={{ ...styles.input, flex: 1, minWidth: 180 }}
              />
              <button onClick={addSizeRow} disabled={dictBusy} style={styles.btnPrimary(!dictBusy)}>
                + Ekle
              </button>
            </div>

            <div style={{ marginTop: 12, ...styles.listWrap }}>
              {(sizes || []).map((x) => (
                <span key={x} style={styles.pill}>
                  {x}
                </span>
              ))}
              {!sizes?.length ? <span style={{ opacity: 0.7 }}>Henüz yok</span> : null}
            </div>
          </div>

          {/* Düzenle */}
          <div style={{ ...styles.card, boxShadow: "none" }}>
            <h5 style={styles.miniTitle}>Düzenle</h5>
            <div style={styles.helper}>Kategori / Renk / Beden değerlerini yeniden adlandırabilir veya pasife alabilirsin.</div>

            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>Kategoriler</div>
                <button onClick={() => openEdit("CATEGORY")} style={styles.btnSmall}>Düzenle</button>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>Renkler</div>
                <button onClick={() => openEdit("COLOR")} style={styles.btnSmall}>Düzenle</button>
              </div>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 800 }}>Bedenler</div>
                <button onClick={() => openEdit("SIZE")} style={styles.btnSmall}>Düzenle</button>
              </div>
            </div>
          </div>
        {editOpen && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: "rgba(0,0,0,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
            onClick={() => setEditOpen(false)}
          >
            <div
              style={{
                width: 820,
                maxWidth: "96vw",
                background: "white",
                borderRadius: 16,
                border: "1px solid rgba(17,24,39,0.10)",
                boxShadow: "0 18px 60px rgba(0,0,0,0.18)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, borderBottom: "1px solid rgba(17,24,39,0.08)" }}>
                <div style={{ fontWeight: 900, fontSize: 16 }}>
                  {editKind === "CATEGORY" ? "Kategorileri Düzenle" : editKind === "COLOR" ? "Renkleri Düzenle" : "Bedenleri Düzenle"}
                </div>
                <button onClick={() => setEditOpen(false)} style={styles.btnSmall}>Kapat</button>
              </div>

              <div style={{ padding: 14 }}>
                {editErr ? <div style={{ marginBottom: 10, color: "crimson", fontWeight: 700 }}>❌ {editErr}</div> : null}

                {editLoading ? (
                  <div style={{ opacity: 0.8 }}>Yükleniyor...</div>
                ) : (
                  <div style={{ display: "grid", gap: 8, maxHeight: "65vh", overflow: "auto", paddingRight: 6 }}>
                    {editRows.map((row) => (
                      <EditDictRow
                        key={row.id}
                        row={row}
                        kind={editKind}
                        onRename={(name) => renameRow(row, name)}
                        onRemove={() => removeOrDeactivate(row)}
                        onActivate={() => activateRow(row)}
                      />
                    ))}
                    {!editRows.length ? <div style={{ opacity: 0.7 }}>Kayıt yok</div> : null}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      {/* Restore card */}
      <div style={{ marginTop: 14, ...styles.card }}>
        <h4 style={styles.cardTitle}>♻️ Yedekten Geri Yükle</h4>


        <div style={styles.divider} />

        <div style={styles.row}>
          <button onClick={pickBackup} style={styles.btn}>Yedek Seç</button>
          <div style={{ fontSize: 12, opacity: 0.85, wordBreak: "break-all" }}>{backupFile ? backupFile : "Henüz seçilmedi"}</div>
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={products} onChange={(e) => setProducts(e.target.checked)} />
            Ürünler
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={sales} onChange={(e) => setSales(e.target.checked)} />
            Satışlar
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={returns} onChange={(e) => setReturns(e.target.checked)} />
            İade / Değişim
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={transfers} onChange={(e) => setTransfers(e.target.checked)} />
            Transferler
          </label>

          <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="checkbox" checked={expenses} onChange={(e) => setExpenses(e.target.checked)} />
            Giderler
          </label>
        </div>

        <div style={{ marginTop: 12, ...styles.row }}>
          <button onClick={doRestore} disabled={!canRestore || restoring} style={styles.btnPrimary(canRestore && !restoring)}>
            {restoring ? "Geri yükleniyor..." : "Geri Yükle"}
          </button>
          {restoreMsg && <div style={{ fontSize: 13 }}>{restoreMsg}</div>}
        </div>
      </div>
    </div>
  );
}
function EditDictRow({
  row,
  kind,
  onRename,
  onRemove,
  onActivate,
}: {
  row: DictItemDto;
  kind: DictKind;
  onRename: (name: string) => void;
  onRemove: () => void;
  onActivate: () => void;
}) {
  const [name, setName] = useState(String(row.name ?? ""));
  const active = Number(row.is_active) === 1;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid rgba(17,24,39,0.10)",
        borderRadius: 12,
        padding: 10,
        background: active ? "#fff" : "#f9fafb",
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ ...styles.input, flex: 1 }}
      />

      {kind === "SIZE" ? (
        <span style={{ fontSize: 12, opacity: 0.7, minWidth: 70, textAlign: "right" }}>{row.sort_order ?? 0}</span>
      ) : (
        <span style={{ fontSize: 12, opacity: 0.7, minWidth: 70 }} />
      )}

      <span style={{ ...styles.badge, background: active ? "#ecfdf5" : "#f3f4f6", borderColor: active ? "rgba(16,185,129,0.25)" : "rgba(17,24,39,0.10)" }}>
        {active ? "Aktif" : "Pasif"}
      </span>

      <button onClick={() => onRename(name)} style={styles.btnSmall}>Kaydet</button>

      {active ? (
        <button onClick={onRemove} style={styles.btnDangerSmall}>Sil / Pasife al</button>
      ) : (
        <button onClick={onActivate} style={styles.btnSmall}>Aktifleştir</button>
      )}
    </div>
  );
}