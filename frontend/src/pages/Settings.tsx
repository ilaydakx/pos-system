import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

const LS_LAST_BACKUP_PATH = "cielpos_last_backup_path";
const LS_LAST_BACKUP_AT = "cielpos_last_backup_at";

function nowLocalLabel() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes()
  )}:${pad(d.getSeconds())}`;
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

  const canRestore = useMemo(() => {
    if (!backupFile) return false;
    return products || sales || returns || transfers || expenses;
  }, [backupFile, products, sales, returns, transfers, expenses]);

  async function pickBackup() {
    setRestoreMsg("");
    const f = await open({
      title: "Yedek seç (.sqlite)",
      multiple: false,
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

      {/* Restore card */}
      <div style={{ marginTop: 14, ...styles.card }}>
        <h4 style={styles.cardTitle}>♻️ Yedekten Geri Yükle</h4>

        <div style={styles.subText}>
          Not: Seçtiğin bölümler mevcut DB’de “silinip” backup’tan kopyalanır. <br />
          <span style={{ opacity: 0.9 }}>Restore sırasında DB kilitliyse uygulamayı kapatıp tekrar deneyebilirsin.</span>
        </div>

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