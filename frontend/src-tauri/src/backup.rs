use std::{fs, path::PathBuf};
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

fn now_stamp() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let secs = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs();
  format!("{}", secs)
}

pub fn backup_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let app_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;

  let dir = app_dir.join("backups");
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  Ok(dir)
}

pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
  let app_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;

  Ok(app_dir.join("ciel_pos.sqlite"))
}

pub fn backup_sqlite_db(app: &AppHandle) -> Result<String, String> {
  let src_path = db_path(app)?;
  if !src_path.exists() {
    return Err(format!("DB bulunamadı: {}", src_path.display()));
  }

  let backups = backup_dir(app)?;
  let file_name = format!("ciel_pos_{}.sqlite", now_stamp());
  let dst_path = backups.join(file_name);

  let src = Connection::open(&src_path).map_err(|e| e.to_string())?;
  let mut dst = Connection::open(&dst_path).map_err(|e| e.to_string())?;

  let bk = rusqlite::backup::Backup::new(&src, &mut dst)
    .map_err(|e: rusqlite::Error| e.to_string())?;

  bk.step(-1).map_err(|e: rusqlite::Error| e.to_string())?;
  Ok(dst_path.to_string_lossy().to_string())
}

// -------------------- RESTORE (GERİ YÜKLEME) --------------------

#[derive(serde::Deserialize)]
pub struct RestoreFromBackupPayload {

  pub backup_path: String,
}

#[derive(serde::Serialize)]
pub struct RestoreFromBackupResult {
  pub restored_db_path: String,
  pub used_backup_path: String,
  pub safety_backup_path: String,
}


pub fn restore_from_backup(app: &AppHandle, payload: RestoreFromBackupPayload) -> Result<RestoreFromBackupResult, String> {
  let db = db_path(app)?;
  let backups_dir = backup_dir(app)?;

  if payload.backup_path.trim().is_empty() {
    return Err("backup_path boş olamaz".into());
  }

  let candidate = PathBuf::from(payload.backup_path.trim());

  let backup_file: PathBuf = if candidate.is_absolute() {
    candidate
  } else {
    backups_dir.join(candidate)
  };

  if !backup_file.exists() {
    return Err(format!("Backup dosyası bulunamadı: {}", backup_file.display()));
  }

  let canon_backup = fs::canonicalize(&backup_file).map_err(|e| e.to_string())?;
  let canon_backups_dir = fs::canonicalize(&backups_dir).map_err(|e| e.to_string())?;
  if !canon_backup.starts_with(&canon_backups_dir) {
    return Err("Güvenlik: Backup dosyası backups klasörünün dışında olamaz.".into());
  }

  let safety_name = format!("ciel_pos_BEFORE_RESTORE_{}.sqlite", now_stamp());
  let safety_path = backups_dir.join(safety_name);

  if db.exists() {

    fs::copy(&db, &safety_path).map_err(|e| {
      format!(
        "Mevcut DB safety backup alınamadı (DB kilitli olabilir). Uygulamayı kapatıp tekrar deneyin. Hata: {}",
        e
      )
    })?;
  }

  let tmp_path = db.with_extension("sqlite.tmp_restore");

  fs::copy(&canon_backup, &tmp_path).map_err(|e| format!("Restore kopyalama hatası: {}", e))?;


  if db.exists() {
    fs::remove_file(&db).map_err(|e| {
      format!(
        "Mevcut DB silinemedi (DB kilitli olabilir). Uygulamayı kapatıp tekrar deneyin. Hata: {}",
        e
      )
    })?;
  }

  fs::rename(&tmp_path, &db).map_err(|e| format!("Restore finalize hatası: {}", e))?;

  Ok(RestoreFromBackupResult {
    restored_db_path: db.to_string_lossy().to_string(),
    used_backup_path: canon_backup.to_string_lossy().to_string(),
    safety_backup_path: safety_path.to_string_lossy().to_string(),
  })
}
