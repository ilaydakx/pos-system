use rusqlite::{params, Connection, OptionalExtension};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

static DB_PATH: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn get_conn() -> Result<Connection, String> {
  let path = DB_PATH
    .get()
    .ok_or_else(|| "DB_PATH not initialized. Did you call db::init(app_handle)?".to_string())?;

  let conn = Connection::open(path).map_err(|e| e.to_string())?;

  conn
    .execute_batch("PRAGMA foreign_keys = ON;")
    .map_err(|e| e.to_string())?;

  Ok(conn)
}

pub fn init(app: &AppHandle) -> Result<(), String> {
  // DB dosya yolu
  let mut path = app
    .path()
    .app_data_dir()
    .map_err(|e| e.to_string())?;

  std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
  path.push("ciel_pos.sqlite");

  let _ = DB_PATH.set(path);

  let conn = get_conn()?;

  // WAL MODU AKTİF
  conn.execute_batch(
    r#"
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    "#,
  )
  .map_err(|e| e.to_string())?;

  migrate(&conn)?;
  seed_option_tables(&conn)?;
  seed_default_dictionaries(&conn)?;

  Ok(())
}

pub fn ping() -> Result<String, String> {
  let conn = get_conn()?;
  conn
    .query_row("SELECT 1;", [], |_row| Ok::<(), rusqlite::Error>(()))
    .map_err(|e| e.to_string())?;
  Ok("OK (sqlite)".to_string())
}
// -------------------- INPUT NORMALIZATION (DB layer) --------------------

fn norm_opt(s: Option<String>) -> Option<String> {
  s.and_then(|v| {
    let t = v.trim().to_string();
    if t.is_empty() { None } else { Some(t) }
  })
}

fn norm_req(field: &str, s: &str) -> Result<String, String> {
  let t = s.trim();
  if t.is_empty() { Err(format!("{} zorunlu", field)) } else { Ok(t.to_string()) }
}

fn normalize_prefix_from_category(cat: Option<&str>) -> String {
  // kategori prefix: TR harflerini ASCII'ye çevir, sadece A-Z0-9, max 3; yoksa PRD
  let raw = cat.unwrap_or("").trim();

  // Türkçe karakterleri ASCII'ye indir
  let mut normalized = String::with_capacity(raw.len());
  for ch in raw.chars() {
    let mapped = match ch {
      'ç' | 'Ç' => 'C',
      'ğ' | 'Ğ' => 'G',
      'ı' | 'İ' => 'I',
      'ö' | 'Ö' => 'O',
      'ş' | 'Ş' => 'S',
      'ü' | 'Ü' => 'U',
      _ => ch,
    };
    normalized.push(mapped);
  }

  let up = normalized.to_uppercase();

  let mut out = String::new();
  for ch in up.chars() {
    if ch.is_ascii_alphanumeric() {
      out.push(ch);
    }
    if out.len() == 3 { break; }
  }

  if out.len() < 3 {
    // 3 harfe tamamla (mesela "ST" kalırsa "STX" gibi)
    while out.len() < 3 {
      out.push('X');
    }
  }

  if out == "XXX" { "PRD".to_string() } else { out }
}

fn next_product_code_for_prefix(conn: &Connection, prefix: &str) -> Result<String, String> {
  // product_code format: PREFIX + 3 digits (e.g. ETK001)
  let like = format!("{}%", prefix);
  let start_pos: i64 = (prefix.len() as i64) + 1; // SUBSTR is 1-based

  let max_n: Option<i64> = conn
    .query_row(
      r#"
      SELECT MAX(CAST(SUBSTR(TRIM(product_code), ?2) AS INTEGER))
      FROM products
      WHERE product_code IS NOT NULL
        AND TRIM(product_code) <> ''
        AND UPPER(product_code) LIKE UPPER(?1)
        AND LENGTH(TRIM(product_code)) >= (?2 + 2)
      "#,
      params![like, start_pos],
      |r| r.get::<_, Option<i64>>(0),
    )
    .map_err(|e| e.to_string())?;

  let next = max_n.unwrap_or(0) + 1;
  if next > 999 {
    return Err(format!("{} için product_code limiti doldu (999)", prefix));
  }

  Ok(format!("{}{:03}", prefix, next))
}


/// DB’den otomatik barkod üretir
fn next_barcode(conn: &Connection) -> Result<String, String> {
  let max_opt: Option<i64> = conn
    .query_row(
      r#"
      SELECT MAX(CAST(barcode AS INTEGER))
      FROM products
      WHERE TRIM(barcode) <> ''
        AND TRIM(barcode) GLOB '[0-9]*'
      "#,
      [],
      |row| row.get::<_, Option<i64>>(0),
    )
    .map_err(|e| e.to_string())?;

  let start: i64 = 1_000_001;
  let next = match max_opt {
    Some(m) if m >= start => m + 1,
    Some(_) => start,
    None => start,
  };

  Ok(next.to_string())
}

#[derive(serde::Serialize)]
pub struct Product {
  pub barcode: String,
  pub product_code: Option<String>,
  pub category: Option<String>,
  pub name: String,
  pub color: Option<String>,
  pub size: Option<String>,
  pub buy_price: f64,
  pub sell_price: f64,
  pub created_at: Option<String>, 


  pub stock: i64,

  pub magaza_baslangic: i64,
  pub depo_baslangic: i64,
  pub magaza_stok: i64,
  pub depo_stok: i64,
}

#[derive(Debug, Clone)]
pub struct CreatedProduct {
  pub barcode: String,
  pub product_code: Option<String>,
}

#[derive(serde::Serialize)]
pub struct SaleLine {
  pub sold_at: String,
  pub qty: i64,
  pub unit_price: f64,
  pub total: f64,
  pub sold_from: String,
  pub refunded_qty: i64,
}

#[derive(serde::Deserialize)]
pub struct CreateReturnPayload {
  pub barcode: String,
  pub qty: i64,
  pub return_to: String,          
  pub sold_at: Option<String>,
  pub sold_from: Option<String>,
  pub unit_price: f64,
}

#[derive(serde::Serialize)]
pub struct CreateReturnResult {
  pub return_group_id: String,
  pub lines: i64,
  pub returned_total: f64,
}

#[derive(serde::Deserialize)]
pub struct CreateExchangeReturnedPayload {
  pub barcode: String,
  pub qty: i64,
  pub return_to: String,
  pub sold_at: Option<String>,
  pub sold_from: Option<String>,
  pub unit_price: f64,
}

#[derive(serde::Deserialize)]
pub struct CreateExchangeGivenItemPayload {
  pub barcode: String,
  pub qty: i64,
  pub sold_from: String,          
  pub unit_price: f64,
}

#[derive(serde::Deserialize)]
pub struct CreateExchangeSummaryPayload {
  pub diff_payment_method: Option<String>, 
}

#[derive(serde::Deserialize)]
pub struct CreateExchangePayload {
  pub returned: CreateExchangeReturnedPayload,
  pub given: Vec<CreateExchangeGivenItemPayload>,
  pub summary: CreateExchangeSummaryPayload,
}


#[derive(serde::Serialize)]
pub struct CreateExchangeResult {
  pub exchange_group_id: String,
  pub lines: i64,
  pub returned_total: f64,
  pub given_total: f64,
  pub diff: f64,
}

pub fn list_products() -> Result<Vec<Product>, String> {
  let conn = get_conn()?;

  let mut stmt = conn
    .prepare(
      r#"
      SELECT
        barcode,
        product_code,
        category,
        name,
        color,
        size,
        COALESCE(buy_price, 0),
        sell_price,
        created_at,
        COALESCE(stock, 0),
        COALESCE(magaza_baslangic, 0),
        COALESCE(depo_baslangic, 0),
        COALESCE(magaza_stok, 0),
        COALESCE(depo_stok, 0)
      FROM products WHERE COALESCE(is_active, 1) = 1
      ORDER BY CAST(barcode AS INTEGER) ASC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map([], |row| {
      Ok(Product {
        barcode: row.get(0)?,
        product_code: row.get(1)?,
        category: row.get(2)?,
        name: row.get(3)?,
        color: row.get(4)?,
        size: row.get(5)?,
        buy_price: row.get(6)?,
        sell_price: row.get(7)?,
        created_at: row.get(8)?, 

        stock: row.get(9)?,
        magaza_baslangic: row.get(10)?,
        depo_baslangic: row.get(11)?,
        magaza_stok: row.get(12)?,
        depo_stok: row.get(13)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut out = Vec::new();
  for r in rows {
    out.push(r.map_err(|e| e.to_string())?);
  }
  Ok(out)
}


pub fn find_product_by_barcode(barcode: &str) -> Result<Option<Product>, String> {
  let conn = get_conn()?;

  let mut stmt = conn
    .prepare(
      r#"
      SELECT
        barcode,
        product_code,
        category,
        name,
        color,
        size,
        COALESCE(buy_price, 0),
        sell_price,
        created_at,
        COALESCE(stock, 0),
        COALESCE(magaza_baslangic, 0),
        COALESCE(depo_baslangic, 0),
        COALESCE(magaza_stok, 0),
        COALESCE(depo_stok, 0)
      FROM products
      WHERE barcode = ?1
      LIMIT 1
      "#,
    )
    .map_err(|e| e.to_string())?;

  let row = stmt
    .query_row(params![barcode], |row| {
      Ok(Product {
        barcode: row.get(0)?,
        product_code: row.get(1)?,
        category: row.get(2)?,
        name: row.get(3)?,
        color: row.get(4)?,
        size: row.get(5)?,
        buy_price: row.get(6)?,
        sell_price: row.get(7)?,
        created_at: row.get(8)?,
        stock: row.get(9)?,
        magaza_baslangic: row.get(10)?,
        depo_baslangic: row.get(11)?,
        magaza_stok: row.get(12)?,
        depo_stok: row.get(13)?,
      })
    })
    .optional()
    .map_err(|e| e.to_string())?;

  Ok(row)
}

/*
pub fn add_product(
  barcode: Option<String>,
  product_code: Option<String>,
  category: Option<String>,
  name: String,
  color: Option<String>,
  size: Option<String>,
  buy_price: Option<f64>,
  sell_price: f64,
  stock: Option<i64>,
  magaza_baslangic: Option<i64>,
  depo_baslangic: Option<i64>,
) -> Result<String, String> {
  let conn = get_conn()?;

  let name = norm_req("Ürün adı", &name)?;
  if !sell_price.is_finite() {
    return Err("Satış fiyatı sayı olmalı".to_string());
  }

  let final_barcode = match norm_opt(barcode) {
    Some(b) => b,
    None => next_barcode(&conn)?,
  };

  let category = norm_opt(category);
  let color = norm_opt(color);
  let size = norm_opt(size);

  // product_code: ürün ailesi kodu (varyantlar aynı kodu paylaşabilir)
  // Kullanıcı bir kod verdiyse ASLA otomatik değiştir/bump yapma.
  // Kod yoksa: kategori prefix + 3 haneli artan (ETK001) üret.
  let product_code = match norm_opt(product_code) {
    Some(pc) => Some(pc.trim().to_uppercase().replace('-', "")),
    None => {
      let prefix = normalize_prefix_from_category(category.as_deref());
      let pc = next_product_code_for_prefix(&conn, &prefix)?;
      Some(pc)
    }
  };

  let bp = buy_price.unwrap_or(0.0);
  let mb = magaza_baslangic.unwrap_or(0);
  let db = depo_baslangic.unwrap_or(0);

  let st = stock.unwrap_or(mb + db);

  let ms = mb;
  let ds = db;

  conn.execute(
    r#"
    INSERT INTO products
      (barcode, product_code, category, name, color, size, buy_price, sell_price, stock,
      magaza_baslangic, depo_baslangic, magaza_stok, depo_stok)
    VALUES
      (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    "#,
    params![
      final_barcode,
      product_code,
      category,
      name,
      color,
      size,
      bp,
      sell_price,
      st,
      mb,
      db,
      ms,
      ds
    ],
  )
  .map_err(|e| e.to_string())?;

  Ok(final_barcode)
}*/
pub fn add_product(
  barcode: Option<String>,
  product_code: Option<String>,
  category: Option<String>,
  name: String,
  color: Option<String>,
  size: Option<String>,
  buy_price: Option<f64>,
  sell_price: f64,
  stock: Option<i64>,
  magaza_baslangic: Option<i64>,
  depo_baslangic: Option<i64>,
) -> Result<CreatedProduct, String> {
  let conn = get_conn()?;

  let name = norm_req("Ürün adı", &name)?;
  if !sell_price.is_finite() {
    return Err("Satış fiyatı sayı olmalı".to_string());
  }

  let final_barcode = match norm_opt(barcode) {
    Some(b) => b,
    None => next_barcode(&conn)?,
  };

  let category = norm_opt(category);
  let color = norm_opt(color);
  let size = norm_opt(size);

  let product_code_final: Option<String> = match norm_opt(product_code) {
    Some(pc) => Some(pc.trim().to_uppercase().replace('-', "")),
    None => {
      let prefix = normalize_prefix_from_category(category.as_deref());
      let pc = next_product_code_for_prefix(&conn, &prefix)?;
      Some(pc)
    }
  };

  let bp = buy_price.unwrap_or(0.0);
  let mb = magaza_baslangic.unwrap_or(0);
  let db = depo_baslangic.unwrap_or(0);

  let st = stock.unwrap_or(mb + db);

  let ms = mb;
  let ds = db;

  conn.execute(
    r#"
    INSERT INTO products
      (barcode, product_code, category, name, color, size, buy_price, sell_price, stock,
       magaza_baslangic, depo_baslangic, magaza_stok, depo_stok)
    VALUES
      (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    "#,
    params![
      final_barcode,
      product_code_final,
      category,
      name,
      color,
      size,
      bp,
      sell_price,
      st,
      mb,
      db,
      ms,
      ds
    ],
  )
  .map_err(|e| e.to_string())?;

  Ok(CreatedProduct {
    barcode: final_barcode,
    product_code: product_code_final,
  })
}

// dashboard
fn scalar_f64(conn: &rusqlite::Connection, sql: &str, p: &[&dyn rusqlite::ToSql]) -> f64 {
  match conn.query_row(sql, p, |row| row.get::<_, f64>(0)) {
    Ok(v) => v,
    Err(_) => 0.0,
  }
}

fn scalar_i64(conn: &rusqlite::Connection, sql: &str, p: &[&dyn rusqlite::ToSql]) -> i64 {
  match conn.query_row(sql, p, |row| row.get::<_, i64>(0)) {
    Ok(v) => v,
    Err(_) => 0,
  }
}
#[derive(serde::Deserialize)]
pub struct UpdateProductPayload {
  pub barcode: String,
  pub product_code: Option<String>,
  pub category: Option<String>,
  pub name: String,
  pub color: Option<String>,
  pub size: Option<String>,
  pub buy_price: Option<f64>,
  pub sell_price: f64,
}

pub fn update_product(payload: UpdateProductPayload) -> Result<i64, String> {
  let conn = get_conn()?;

  let bc = payload.barcode.trim();
  if bc.is_empty() {
    return Err("Barkod zorunlu".to_string());
  }
  let name = norm_req("Ürün adı", &payload.name)?;

  // product_code: varyant ailesi kodu. Unique değil.
  // UI boş gönderirse mevcut değer korunmalı.
  let product_code = norm_opt(payload.product_code)
    .map(|pc| pc.trim().to_uppercase().replace('-', ""));
  let category = norm_opt(payload.category);
  let color = norm_opt(payload.color);
  let size = norm_opt(payload.size);

  if !payload.sell_price.is_finite() {
    return Err("Satış fiyatı sayı olmalı".to_string());
  }

  let bp = payload.buy_price.unwrap_or(0.0);

  let changed = conn
    .execute(
      r#"
      UPDATE products
      SET
        product_code = COALESCE(?2, product_code),
        category     = ?3,
        name         = ?4,
        color        = ?5,
        size         = ?6,
        buy_price    = ?7,
        sell_price   = ?8,
        updated_at   = datetime('now','localtime')
      WHERE barcode = ?1
        AND COALESCE(is_active,1)=1
      "#,
      params![
        bc,
        product_code,
        category,
        name,
        color,
        size,
        bp,
        payload.sell_price
      ],
    )
    .map_err(|e| e.to_string())?;

  Ok(changed as i64)
}
#[derive(serde::Serialize)]
pub struct CategoryRow {
  pub id: i64,
  pub name: String,
  pub is_active: i64,
  pub created_at: Option<String>,
}
pub fn list_categories_full(include_inactive: bool) -> Result<Vec<CategoryRow>, String> {
  let conn = get_conn()?;
  let include = if include_inactive { 1 } else { 0 };

  let mut st = conn
    .prepare(
      r#"
      SELECT id, name, COALESCE(is_active,1) AS is_active, created_at
      FROM categories
      WHERE (?1 = 1) OR COALESCE(is_active,1)=1
      ORDER BY name ASC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let rows = st
    .query_map(params![include], |r| {
      Ok(CategoryRow {
        id: r.get(0)?,
        name: r.get(1)?,
        is_active: r.get(2)?,
        created_at: r.get(3)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut out = Vec::new();
  for x in rows {
    out.push(x.map_err(|e| e.to_string())?);
  }
  Ok(out)
}



#[derive(serde::Serialize)]
pub struct ColorRow {
  pub id: i64,
  pub name: String,
  pub is_active: i64,
  pub created_at: Option<String>,
}

pub fn list_colors_full(include_inactive: bool) -> Result<Vec<ColorRow>, String> {
  let conn = get_conn()?;
  let include = if include_inactive { 1 } else { 0 };

  let mut st = conn
    .prepare(
      r#"
      SELECT id, name, COALESCE(is_active,1) AS is_active, created_at
      FROM colors
      WHERE (?1 = 1) OR COALESCE(is_active,1)=1
      ORDER BY name ASC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let rows = st
    .query_map(params![include], |r| {
      Ok(ColorRow {
        id: r.get(0)?,
        name: r.get(1)?,
        is_active: r.get(2)?,
        created_at: r.get(3)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut out = Vec::new();
  for x in rows {
    out.push(x.map_err(|e| e.to_string())?);
  }
  Ok(out)
}


// ------- Helper functions to count products using a category/color/size -------
fn count_products_using_category(tx: &rusqlite::Connection, id: i64, name: &str) -> i64 {
  let used_by_id: i64 = tx
    .query_row(
      "SELECT COALESCE(COUNT(*),0) FROM products WHERE COALESCE(category_id,0)=?1",
      params![id],
      |r| r.get(0),
    )
    .unwrap_or(0);

  let used_by_text: i64 = tx
    .query_row(
      "SELECT COALESCE(COUNT(*),0) FROM products WHERE TRIM(COALESCE(category,'')) = TRIM(?1)",
      params![name],
      |r| r.get(0),
    )
    .unwrap_or(0);

  used_by_id + used_by_text
}

fn count_products_using_color(tx: &rusqlite::Connection, id: i64, name: &str) -> i64 {
  let used_by_id: i64 = tx
    .query_row(
      "SELECT COALESCE(COUNT(*),0) FROM products WHERE COALESCE(color_id,0)=?1",
      params![id],
      |r| r.get(0),
    )
    .unwrap_or(0);

  let used_by_text: i64 = tx
    .query_row(
      "SELECT COALESCE(COUNT(*),0) FROM products WHERE TRIM(COALESCE(color,'')) = TRIM(?1)",
      params![name],
      |r| r.get(0),
    )
    .unwrap_or(0);

  used_by_id + used_by_text
}

fn count_products_using_size(tx: &rusqlite::Connection, id: i64, name: &str) -> i64 {
  let used_by_id: i64 = tx
    .query_row(
      "SELECT COALESCE(COUNT(*),0) FROM products WHERE COALESCE(size_id,0)=?1",
      params![id],
      |r| r.get(0),
    )
    .unwrap_or(0);

  let used_by_text: i64 = tx
    .query_row(
      "SELECT COALESCE(COUNT(*),0) FROM products WHERE TRIM(COALESCE(size,'')) = TRIM(?1)",
      params![name],
      |r| r.get(0),
    )
    .unwrap_or(0);

  used_by_id + used_by_text
}
pub fn update_color(id: i64, name: Option<String>, is_active: Option<i64>) -> Result<i64, String> {
  if id <= 0 {
    return Err("id geçersiz".to_string());
  }

  let conn = get_conn()?;

  let exists: Option<i64> = conn
    .query_row("SELECT id FROM colors WHERE id=?1", params![id], |r| r.get(0))
    .optional()
    .map_err(|e| e.to_string())?;

  if exists.is_none() {
    return Err("Renk bulunamadı".to_string());
  }

  let mut changed: i64 = 0;

  if let Some(n) = name {
    let t = n.trim();
    if t.is_empty() {
      return Err("Renk adı boş olamaz".to_string());
    }

    let c = conn
      .execute("UPDATE colors SET name=?2 WHERE id=?1", params![id, t])
      .map_err(|e| e.to_string())?;
    changed += c as i64;
  }

  if let Some(a) = is_active {
    let v = if a == 0 { 0 } else { 1 };

    // Eğer pasife alınacaksa ve ürünlerde kullanılıyorsa engelle
    if v == 0 {
      let color_name: String = conn
        .query_row("SELECT name FROM colors WHERE id=?1", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
      let used = count_products_using_color(&conn, id, &color_name);
      if used > 0 {
        return Err("Bu renk ürünlerde kullanılıyor; pasife alınamaz".to_string());
      }
    }

    let c = conn
      .execute("UPDATE colors SET is_active=?2 WHERE id=?1", params![id, v])
      .map_err(|e| e.to_string())?;
    changed += c as i64;
  }

  Ok(changed)
}

pub fn delete_color(id: i64) -> Result<i64, String> {
  if id <= 0 {
    return Err("id geçersiz".to_string());
  }

  let mut conn = get_conn()?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  let color_name: Option<String> = tx
    .query_row("SELECT name FROM colors WHERE id=?1", params![id], |r| r.get(0))
    .optional()
    .map_err(|e| e.to_string())?;

  let color_name = color_name.ok_or_else(|| "Renk bulunamadı".to_string())?;

  let used = count_products_using_color(&tx, id, &color_name);

  if used > 0 {
    return Err("Bu renk ürünlerde kullanılıyor; silinemez / pasife alınamaz".to_string());
  }

  // hiç kullanılmamışsa hard delete
  let c = tx
    .execute("DELETE FROM colors WHERE id=?1", params![id])
    .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;
  Ok(c as i64)
}
pub fn add_category(name: String) -> Result<i64, String> {
  let conn = get_conn()?;
  let n = name.trim();
  if n.is_empty() {
    return Err("Kategori adı boş olamaz".to_string());
  }

  conn.execute(
    "INSERT OR IGNORE INTO categories(name, is_active) VALUES (?1, 1)",
    params![n],
  ).map_err(|e| e.to_string())?;

  Ok(1)
}

pub fn create_category(name: String) -> Result<i64, String> {
  add_category(name)
}
pub fn update_category(id: i64, name: Option<String>, is_active: Option<i64>) -> Result<i64, String> {
  if id <= 0 {
    return Err("id geçersiz".to_string());
  }

  let conn = get_conn()?;

  let exists: Option<i64> = conn
    .query_row("SELECT id FROM categories WHERE id=?1", params![id], |r| r.get(0))
    .optional()
    .map_err(|e| e.to_string())?;

  if exists.is_none() {
    return Err("Kategori bulunamadı".to_string());
  }

  let mut changed: i64 = 0;

  if let Some(n) = name {
    let t = n.trim();
    if t.is_empty() {
      return Err("Kategori adı boş olamaz".to_string());
    }

    let c = conn
      .execute("UPDATE categories SET name=?2 WHERE id=?1", params![id, t])
      .map_err(|e| e.to_string())?;
    changed += c as i64;
  }

  if let Some(a) = is_active {
    let v = if a == 0 { 0 } else { 1 };

    if v == 0 {
      let cat_name: String = conn
        .query_row("SELECT name FROM categories WHERE id=?1", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
      let used = count_products_using_category(&conn, id, &cat_name);
      if used > 0 {
        return Err("Bu kategori ürünlerde kullanılıyor; pasife alınamaz".to_string());
      }
    }

    let c = conn
      .execute("UPDATE categories SET is_active=?2 WHERE id=?1", params![id, v])
      .map_err(|e| e.to_string())?;
    changed += c as i64;
  }

  Ok(changed)
}

pub fn delete_category(id: i64) -> Result<i64, String> {
  if id <= 0 {
    return Err("id geçersiz".to_string());
  }

  let mut conn = get_conn()?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  let cat_name: Option<String> = tx
    .query_row("SELECT name FROM categories WHERE id=?1", params![id], |r| r.get(0))
    .optional()
    .map_err(|e| e.to_string())?;

  let cat_name = cat_name.ok_or_else(|| "Kategori bulunamadı".to_string())?;

  let used = count_products_using_category(&tx, id, &cat_name);

  if used > 0 {
    return Err("Bu kategori ürünlerde kullanılıyor; silinemez / pasife alınamaz".to_string());
  }

  let c = tx
    .execute("DELETE FROM categories WHERE id=?1", params![id])
    .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;
  Ok(c as i64)
}

pub fn add_color(name: String) -> Result<i64, String> {
  let conn = get_conn()?;
  let n = name.trim();
  if n.is_empty() {
    return Err("Renk adı boş olamaz".to_string());
  }

  conn.execute(
    "INSERT OR IGNORE INTO colors(name, is_active) VALUES (?1, 1)",
    params![n],
  ).map_err(|e| e.to_string())?;

  Ok(1)
}

pub fn create_color(name: String) -> Result<i64, String> {
  add_color(name)
}

pub fn add_size(name: String, order_no: Option<i64>) -> Result<i64, String> {
  let conn = get_conn()?;
  let n = name.trim();
  if n.is_empty() {
    return Err("Beden adı boş olamaz".to_string());
  }

  let so = order_no.unwrap_or(0);

  // new column
  conn.execute(
    "INSERT OR IGNORE INTO sizes(name, sort_order, is_active) VALUES (?1, ?2, 1)",
    params![n, so],
  ).map_err(|e| e.to_string())?;

  // legacy column (ignore if not exists)
  let _ = conn.execute(
    "UPDATE sizes SET order_no = COALESCE(order_no, ?2) WHERE name = ?1",
    params![n, so],
  );

  Ok(1)
}

pub fn create_size(name: String, sort_order: Option<i64>) -> Result<i64, String> {
  add_size(name, sort_order)
}


#[derive(serde::Serialize)]
pub struct SizeRow {
  pub id: i64,
  pub name: String,
  pub sort_order: i64,
  pub is_active: i64,
  pub created_at: Option<String>,
}

pub fn list_sizes_full(include_inactive: bool) -> Result<Vec<SizeRow>, String> {
  let conn = get_conn()?;
  let include = if include_inactive { 1 } else { 0 };

  let mut st = conn
    .prepare(
      r#"
      SELECT id, name,
        COALESCE(sort_order, 0) AS sort_order,
        COALESCE(is_active,1) AS is_active,
        created_at
      FROM sizes
      WHERE (?1 = 1) OR COALESCE(is_active,1)=1
      ORDER BY COALESCE(sort_order, 0) ASC, name ASC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let rows = st
    .query_map(params![include], |r| {
      Ok(SizeRow {
        id: r.get(0)?,
        name: r.get(1)?,
        sort_order: r.get(2)?,
        is_active: r.get(3)?,
        created_at: r.get(4)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut out = Vec::new();
  for x in rows {
    out.push(x.map_err(|e| e.to_string())?);
  }
  Ok(out)
}


pub fn update_size(
  id: i64,
  name: Option<String>,
  sort_order: Option<i64>,
  is_active: Option<i64>,
) -> Result<i64, String> {
  if id <= 0 {
    return Err("id geçersiz".to_string());
  }

  let conn = get_conn()?;

  let exists: Option<i64> = conn
    .query_row("SELECT id FROM sizes WHERE id=?1", params![id], |r| r.get(0))
    .optional()
    .map_err(|e| e.to_string())?;

  if exists.is_none() {
    return Err("Beden bulunamadı".to_string());
  }

  let mut changed: i64 = 0;

  if let Some(n) = name {
    let t = n.trim();
    if t.is_empty() {
      return Err("Beden adı boş olamaz".to_string());
    }

    let c = conn
      .execute("UPDATE sizes SET name=?2 WHERE id=?1", params![id, t])
      .map_err(|e| e.to_string())?;
    changed += c as i64;
  }

  if let Some(so) = sort_order {
    let c = conn
      .execute("UPDATE sizes SET sort_order=?2 WHERE id=?1", params![id, so])
      .map_err(|e| e.to_string())?;
    changed += c as i64;

    // legacy column support (ignore if not exists)
    let _ = conn.execute(
      "UPDATE sizes SET order_no = COALESCE(order_no, ?2) WHERE id=?1",
      params![id, so],
    );
  }

  if let Some(a) = is_active {
    let v = if a == 0 { 0 } else { 1 };

    if v == 0 {
      let size_name: String = conn
        .query_row("SELECT name FROM sizes WHERE id=?1", params![id], |r| r.get(0))
        .map_err(|e| e.to_string())?;
      let used = count_products_using_size(&conn, id, &size_name);
      if used > 0 {
        return Err("Bu beden ürünlerde kullanılıyor; pasife alınamaz".to_string());
      }
    }

    let c = conn
      .execute("UPDATE sizes SET is_active=?2 WHERE id=?1", params![id, v])
      .map_err(|e| e.to_string())?;
    changed += c as i64;
  }

  Ok(changed)
}


pub fn delete_size(id: i64) -> Result<i64, String> {
  if id <= 0 {
    return Err("id geçersiz".to_string());
  }

  let mut conn = get_conn()?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  let size_name: Option<String> = tx
    .query_row("SELECT name FROM sizes WHERE id=?1", params![id], |r| r.get(0))
    .optional()
    .map_err(|e| e.to_string())?;

  let size_name = size_name.ok_or_else(|| "Beden bulunamadı".to_string())?;

  let used = count_products_using_size(&tx, id, &size_name);

  if used > 0 {
    return Err("Bu beden ürünlerde kullanılıyor; silinemez / pasife alınamaz".to_string());
  }

  let c = tx
    .execute("DELETE FROM sizes WHERE id=?1", params![id])
    .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;
  Ok(c as i64)
}

pub fn get_dashboard_summary(days: i64, months: i64) -> Result<DashboardSummary, String> {
  let conn = get_conn()?;

  let days = days.clamp(1, 90);
  let months = months.clamp(1, 24);

  let sales_for_revenue = r#"(
    COALESCE(voided,0)=0
    OR EXISTS (
      SELECT 1
      FROM return_items ri
      JOIN returns r ON r.return_group_id = ri.return_group_id
      WHERE r.mode='EXCHANGE'
        AND ri.ref_sale_id = sales.id
    )
  )"#;

  let sales_active = "COALESCE(voided,0)=0";
  let sales_active_s = "COALESCE(s.voided,0)=0";

  // TODAY
  let today_sales_qty_active = scalar_i64(
    &conn,
    &format!(
      "SELECT COALESCE(SUM(qty),0) FROM sales WHERE {} AND date(sold_at)=date('now','localtime')",
      sales_active
    ),
    &[],
  );

  let today_exchange_qty = scalar_i64(
    &conn,
    r#"SELECT COALESCE(SUM(ei.qty),0)
       FROM exchange_items ei
       JOIN returns r ON r.return_group_id = ei.exchange_group_id
       WHERE r.mode='EXCHANGE'
         AND date(r.created_at)=date('now','localtime')"#,
    &[],
  );

  let today_refund_qty = scalar_i64(
    &conn,
    r#"SELECT COALESCE(SUM(ri.qty),0)
       FROM return_items ri
       JOIN returns r ON r.return_group_id = ri.return_group_id
       WHERE r.mode='REFUND'
         AND date(r.created_at)=date('now','localtime')"#,
    &[],
  );

  let today_qty = (today_sales_qty_active + today_exchange_qty - today_refund_qty).max(0);

  // net ciro için: satış toplam (revenue şartlı) + return_diff (refund negatif, exchange diff)
  let today_sales_total = scalar_f64(
    &conn,
    &format!(
      "SELECT COALESCE(SUM(total),0) FROM sales WHERE {} AND date(sold_at)=date('now','localtime')",
      sales_for_revenue
    ),
    &[],
  );

  let today_return_diff = scalar_f64(
    &conn,
    "SELECT COALESCE(SUM(diff),0) FROM returns WHERE date(created_at)=date('now','localtime')",
    &[],
  );

  let today_net_revenue = today_sales_total + today_return_diff;

  // THIS MONTH 
  let month_sales_total = scalar_f64(
    &conn,
    &format!(
      "SELECT COALESCE(SUM(total),0) FROM sales WHERE {} AND strftime('%Y-%m',sold_at)=strftime('%Y-%m','now','localtime')",
      sales_for_revenue
    ),
    &[],
  );

  let month_return_diff = scalar_f64(
    &conn,
    "SELECT COALESCE(SUM(diff),0) FROM returns WHERE strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime')",
    &[],
  );

  let month_net_revenue = month_sales_total + month_return_diff;

  // Brüt kâr: aktif satış kârı + exchange verilen ürün kârı - refund iade edilen ürün kârı
  let month_gross_profit_sales: f64 = conn
    .query_row(
      &format!(
        r#"
        SELECT COALESCE(SUM((s.unit_price - COALESCE(p.buy_price,0)) * s.qty),0)
        FROM sales s
        LEFT JOIN products p ON p.barcode = s.product_barcode
        WHERE {cond}
          AND strftime('%Y-%m', s.sold_at) = strftime('%Y-%m','now','localtime')
        "#,
        cond = sales_active_s
      ),
      [],
      |row| row.get::<_, f64>(0),
    )
    .map_err(|e| format!("month_gross_profit_sales query error: {}", e))?;

  let month_exchange_profit: f64 = conn
    .query_row(
      r#"
      SELECT COALESCE(SUM((ei.unit_price - COALESCE(p.buy_price,0)) * ei.qty),0)
      FROM exchange_items ei
      JOIN returns r ON r.return_group_id = ei.exchange_group_id
      LEFT JOIN products p ON p.barcode = ei.product_barcode
      WHERE r.mode='EXCHANGE'
        AND strftime('%Y-%m', r.created_at) = strftime('%Y-%m','now','localtime')
      "#,
      [],
      |row| row.get::<_, f64>(0),
    )
    .map_err(|e| format!("month_exchange_profit query error: {}", e))?;

  let month_refund_profit: f64 = conn
    .query_row(
      r#"
      SELECT COALESCE(SUM((ri.unit_price - COALESCE(p.buy_price,0)) * ri.qty),0)
      FROM return_items ri
      JOIN returns r ON r.return_group_id = ri.return_group_id
      LEFT JOIN products p ON p.barcode = ri.product_barcode
      WHERE r.mode='REFUND'
        AND strftime('%Y-%m', r.created_at)=strftime('%Y-%m','now','localtime')
      "#,
      [],
      |row| row.get::<_, f64>(0),
    )
    .map_err(|e| format!("month_refund_profit query error: {}", e))?;

  let month_gross_profit = month_gross_profit_sales + month_exchange_profit - month_refund_profit;

  let month_expense = scalar_f64(
    &conn,
    "SELECT COALESCE(SUM(amount),0) FROM expenses WHERE strftime('%Y-%m',spent_at)=strftime('%Y-%m','now','localtime')",
    &[],
  );

  let month_net_profit = month_gross_profit - month_expense;

  // ortalama sepet = net ciro / fiş sayısı
  let month_receipts = scalar_i64(
    &conn,
    &format!(
      "SELECT COALESCE(COUNT(DISTINCT sale_group_id),0) FROM sales WHERE {} AND strftime('%Y-%m',sold_at)=strftime('%Y-%m','now','localtime')",
      sales_for_revenue
    ),
    &[],
  );

  let month_avg_basket = if month_receipts > 0 {
    month_net_revenue / (month_receipts as f64)
  } else {
    0.0
  };

  // DAILY SERIES 
  let mut daily = Vec::new();
  for i in (0..days).rev() {
    let day: String = conn
      .query_row(
        "SELECT date('now','localtime', printf('-%d day', ?1))",
        rusqlite::params![i],
        |row| row.get(0),
      )
      .map_err(|e| e.to_string())?;

    // net adet: aktif satış + exchange verilen - refund
    let sales_qty_active = scalar_i64(
      &conn,
      &format!(
        "SELECT COALESCE(SUM(qty),0) FROM sales WHERE {} AND date(sold_at)=?1",
        sales_active
      ),
      &[&day],
    );

    let exchange_qty = scalar_i64(
      &conn,
      r#"SELECT COALESCE(SUM(ei.qty),0)
         FROM exchange_items ei
         JOIN returns r ON r.return_group_id = ei.exchange_group_id
         WHERE r.mode='EXCHANGE'
           AND date(r.created_at)=?1"#,
      &[&day],
    );

    let refund_qty = scalar_i64(
      &conn,
      r#"SELECT COALESCE(SUM(ri.qty),0)
         FROM return_items ri
         JOIN returns r ON r.return_group_id = ri.return_group_id
         WHERE r.mode='REFUND'
           AND date(r.created_at)=?1"#,
      &[&day],
    );

    let net_qty = (sales_qty_active + exchange_qty - refund_qty).max(0);

    // net ciro: revenue şartlı satış toplam + returns.diff
    let sales_total = scalar_f64(
      &conn,
      &format!(
        "SELECT COALESCE(SUM(total),0) FROM sales WHERE {} AND date(sold_at)=?1",
        sales_for_revenue
      ),
      &[&day],
    );

    let return_diff = scalar_f64(
      &conn,
      "SELECT COALESCE(SUM(diff),0) FROM returns WHERE date(created_at)=?1",
      &[&day],
    );

    let net_revenue = sales_total + return_diff;

    // brüt kâr: aktif satış kârı + exchange kârı - refund kârı
    let gross_profit_sales = match conn.query_row(
      &format!(
        r#"
        SELECT COALESCE(SUM((s.unit_price - COALESCE(p.buy_price,0)) * s.qty),0)
        FROM sales s
        LEFT JOIN products p ON p.barcode = s.product_barcode
        WHERE {cond}
          AND date(s.sold_at)=?1
        "#,
        cond = sales_active_s
      ),
      [&day],
      |row| row.get::<_, f64>(0),
    ) {
      Ok(v) => v,
      Err(_) => 0.0,
    };

    let exchange_profit = match conn.query_row(
      r#"
      SELECT COALESCE(SUM((ei.unit_price - COALESCE(p.buy_price,0)) * ei.qty),0)
      FROM exchange_items ei
      JOIN returns r ON r.return_group_id = ei.exchange_group_id
      LEFT JOIN products p ON p.barcode = ei.product_barcode
      WHERE r.mode='EXCHANGE'
        AND date(r.created_at)=?1
      "#,
      [&day],
      |row| row.get::<_, f64>(0),
    ) {
      Ok(v) => v,
      Err(_) => 0.0,
    };

    let refund_profit = match conn.query_row(
      r#"
      SELECT COALESCE(SUM((ri.unit_price - COALESCE(p.buy_price,0)) * ri.qty),0)
      FROM return_items ri
      JOIN returns r ON r.return_group_id = ri.return_group_id
      LEFT JOIN products p ON p.barcode = ri.product_barcode
      WHERE r.mode='REFUND'
        AND date(r.created_at)=?1
      "#,
      [&day],
      |row| row.get::<_, f64>(0),
    ) {
      Ok(v) => v,
      Err(_) => 0.0,
    };

    let gross_profit = gross_profit_sales + exchange_profit - refund_profit;

    // ortalama sepet: net ciro / fiş sayısı (revenue şartlı)
    let receipts = scalar_i64(
      &conn,
      &format!(
        "SELECT COALESCE(COUNT(DISTINCT sale_group_id),0) FROM sales WHERE {} AND date(sold_at)=?1",
        sales_for_revenue
      ),
      &[&day],
    );

    let avg_basket = if receipts > 0 { net_revenue / receipts as f64 } else { 0.0 };

    if net_qty == 0 && net_revenue.abs() < 0.0001 && gross_profit.abs() < 0.0001 {
      continue;
    }

    daily.push(DailyDashboardRow {
      day,
      net_qty,
      net_revenue,
      gross_profit,
      avg_basket,
    });
  }

  // MONTHLY SERIES 
  let mut monthly = Vec::new();
  for i in (0..months).rev() {
    let period: String = conn
      .query_row(
        "SELECT strftime('%Y-%m', date('now','localtime', printf('-%d month', ?1)))",
        rusqlite::params![i],
        |row| row.get(0),
      )
      .map_err(|e| e.to_string())?;

    // net adet: aktif satış + exchange verilen - refund
    let sales_qty_active = scalar_i64(
      &conn,
      &format!(
        "SELECT COALESCE(SUM(qty),0) FROM sales WHERE {} AND strftime('%Y-%m',sold_at)=?1",
        sales_active
      ),
      &[&period],
    );

    let exchange_qty = scalar_i64(
      &conn,
      r#"SELECT COALESCE(SUM(ei.qty),0)
         FROM exchange_items ei
         JOIN returns r ON r.return_group_id = ei.exchange_group_id
         WHERE r.mode='EXCHANGE'
           AND strftime('%Y-%m', r.created_at)=?1"#,
      &[&period],
    );

    let refund_qty = scalar_i64(
      &conn,
      r#"SELECT COALESCE(SUM(ri.qty),0)
         FROM return_items ri
         JOIN returns r ON r.return_group_id = ri.return_group_id
         WHERE r.mode='REFUND'
           AND strftime('%Y-%m', r.created_at)=?1"#,
      &[&period],
    );

    let net_qty = (sales_qty_active + exchange_qty - refund_qty).max(0);

    // net ciro: revenue şartlı satış toplam + returns.diff
    let sales_total = scalar_f64(
      &conn,
      &format!(
        "SELECT COALESCE(SUM(total),0) FROM sales WHERE {} AND strftime('%Y-%m',sold_at)=?1",
        sales_for_revenue
      ),
      &[&period],
    );

    let return_diff = scalar_f64(
      &conn,
      "SELECT COALESCE(SUM(diff),0) FROM returns WHERE strftime('%Y-%m',created_at)=?1",
      &[&period],
    );

    let net_revenue = sales_total + return_diff;

    // brüt kâr: aktif satış kârı + exchange kârı - refund kârı
    let gross_profit_sales = match conn.query_row(
      &format!(
        r#"
        SELECT COALESCE(SUM((s.unit_price - COALESCE(p.buy_price,0)) * s.qty),0)
        FROM sales s
        LEFT JOIN products p ON p.barcode = s.product_barcode
        WHERE {cond}
          AND strftime('%Y-%m',s.sold_at)=?1
        "#,
        cond = sales_active_s
      ),
      [&period],
      |row| row.get::<_, f64>(0),
    ) {
      Ok(v) => v,
      Err(_) => 0.0,
    };

    let exchange_profit = match conn.query_row(
      r#"
      SELECT COALESCE(SUM((ei.unit_price - COALESCE(p.buy_price,0)) * ei.qty),0)
      FROM exchange_items ei
      JOIN returns r ON r.return_group_id = ei.exchange_group_id
      LEFT JOIN products p ON p.barcode = ei.product_barcode
      WHERE r.mode='EXCHANGE'
        AND strftime('%Y-%m', r.created_at)=?1
      "#,
      [&period],
      |row| row.get::<_, f64>(0),
    ) {
      Ok(v) => v,
      Err(_) => 0.0,
    };

    let refund_profit = match conn.query_row(
      r#"
      SELECT COALESCE(SUM((ri.unit_price - COALESCE(p.buy_price,0)) * ri.qty),0)
      FROM return_items ri
      JOIN returns r ON r.return_group_id = ri.return_group_id
      LEFT JOIN products p ON p.barcode = ri.product_barcode
      WHERE r.mode='REFUND'
        AND strftime('%Y-%m', r.created_at)=?1
      "#,
      [&period],
      |row| row.get::<_, f64>(0),
    ) {
      Ok(v) => v,
      Err(_) => 0.0,
    };

    let gross_profit = gross_profit_sales + exchange_profit - refund_profit;

    let expense = scalar_f64(
      &conn,
      "SELECT COALESCE(SUM(amount),0) FROM expenses WHERE strftime('%Y-%m',spent_at)=?1",
      &[&period],
    );

    let net_profit = gross_profit - expense;

    let receipts = scalar_i64(
      &conn,
      &format!(
        "SELECT COALESCE(COUNT(DISTINCT sale_group_id),0) FROM sales WHERE {} AND strftime('%Y-%m',sold_at)=?1",
        sales_for_revenue
      ),
      &[&period],
    );

    let avg_basket = if receipts > 0 { net_revenue / receipts as f64 } else { 0.0 };

    if net_qty == 0
      && net_revenue.abs() < 0.0001
      && gross_profit.abs() < 0.0001
      && expense.abs() < 0.0001
    {
      continue;
    }

    monthly.push(MonthlyDashboardRow {
      period,
      net_qty,
      net_revenue,
      gross_profit,
      expense,
      net_profit,
      avg_basket,
    });
  }

  Ok(DashboardSummary {
    kpi: DashboardKpi {
      today_qty,
      today_net_revenue,
      month_gross_profit,
      month_net_profit,
      month_avg_basket,
      month_expense,
    },
    daily,
    monthly,
  })
}

pub fn delete_product(barcode: &str) -> Result<i64, String> {
  let mut conn = get_conn()?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  let hard = tx.execute(
    "DELETE FROM products WHERE barcode = ?1",
    rusqlite::params![barcode],
  );

  match hard {
    Ok(n) => {
      tx.commit().map_err(|e| e.to_string())?;
      Ok(n as i64) 
    }
    Err(e) => {
      let msg = e.to_string();
      if !msg.to_lowercase().contains("foreign key") {
        return Err(msg);
      }

      tx.execute(
        r#"
        UPDATE products
        SET
          is_active = 0,
          stock = 0,
          magaza_stok = 0,
          depo_stok = 0,
          updated_at = datetime('now','localtime')
        WHERE barcode = ?1
        "#,
        rusqlite::params![barcode],
      )
      .map_err(|e| e.to_string())?;

      tx.commit().map_err(|e| e.to_string())?;

      Ok(1)
    }
  }
}

fn migrate(conn: &Connection) -> Result<(), String> {
  conn
    .execute_batch(
      r#"
      CREATE TABLE IF NOT EXISTS products (
        barcode           TEXT PRIMARY KEY,
        product_code      TEXT,
        category          TEXT,
        name              TEXT NOT NULL,
        color             TEXT,
        size              TEXT,
        buy_price         REAL DEFAULT 0,
        sell_price        REAL NOT NULL DEFAULT 0,

        -- legacy toplam stok
        stock             INTEGER DEFAULT 0,

        -- yeni stok modeli
        magaza_baslangic  INTEGER DEFAULT 0,
        depo_baslangic    INTEGER DEFAULT 0,
        magaza_stok       INTEGER DEFAULT 0,
        depo_stok         INTEGER DEFAULT 0,

        is_active         INTEGER DEFAULT 1,
        created_at        TEXT DEFAULT (datetime('now','localtime')),
        updated_at        TEXT DEFAULT (datetime('now','localtime')),

        category_id INTEGER,
        color_id    INTEGER,
        size_id     INTEGER,
        FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE RESTRICT,
        FOREIGN KEY(color_id)    REFERENCES colors(id)     ON DELETE RESTRICT,
        FOREIGN KEY(size_id)     REFERENCES sizes(id)      ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS sales (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        product_barcode TEXT NOT NULL,
        qty             INTEGER NOT NULL,

        -- fiyatlar
        list_price       REAL DEFAULT 0,
        discount_amount  REAL DEFAULT 0,
        unit_price       REAL NOT NULL,
        total            REAL NOT NULL,

        -- fiş gruplama + satış yeri
        sale_group_id   TEXT,
        sold_from       TEXT,

        -- iptal
        voided          INTEGER DEFAULT 0,

        -- ödeme tipi (fiş bazlı aynı)
        payment_method  TEXT NOT NULL DEFAULT 'CARD',

        sold_at         TEXT DEFAULT (datetime('now','localtime')),
        note            TEXT,
        FOREIGN KEY(product_barcode) REFERENCES products(barcode) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS expenses (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        title         TEXT NOT NULL,
        amount        REAL NOT NULL,
        spent_at      TEXT DEFAULT (datetime('now','localtime')),
        period        TEXT,
        category      TEXT,
        note          TEXT
      );

      CREATE TABLE IF NOT EXISTS transfers (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        product_barcode TEXT NOT NULL,
        qty             INTEGER NOT NULL,
        from_loc        TEXT NOT NULL,   -- 'MAGAZA' | 'DEPO'
        to_loc          TEXT NOT NULL,   -- 'MAGAZA' | 'DEPO'
        transfer_group_id TEXT,
        note            TEXT,
        transferred_at  TEXT DEFAULT (datetime('now','localtime')),
        voided          INTEGER DEFAULT 0,
        FOREIGN KEY(product_barcode) REFERENCES products(barcode) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS returns (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        return_group_id TEXT NOT NULL,
        mode            TEXT NOT NULL, -- 'REFUND' | 'EXCHANGE'
        returned_total  REAL NOT NULL DEFAULT 0,
        given_total     REAL NOT NULL DEFAULT 0,
        diff            REAL NOT NULL DEFAULT 0,
        diff_payment_method TEXT,
        created_at      TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS return_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        return_group_id TEXT NOT NULL,
        product_barcode TEXT NOT NULL,
        qty             INTEGER NOT NULL,
        unit_price      REAL NOT NULL,
        total           REAL NOT NULL,

        -- iade stoğu nereye girdi
        return_to       TEXT NOT NULL,  -- 'MAGAZA' | 'DEPO'

        -- referans satış (varsa)
        ref_sale_id     INTEGER,        -- sales.id
        ref_sold_at      TEXT,
        ref_sold_from    TEXT,

        created_at      TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY(product_barcode) REFERENCES products(barcode) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS exchange_items (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        exchange_group_id TEXT NOT NULL,
        product_barcode TEXT NOT NULL,
        qty             INTEGER NOT NULL,
        unit_price      REAL NOT NULL,
        total           REAL NOT NULL,
        sold_from       TEXT NOT NULL,  -- verilen ürün nereden çıktı (MAGAZA|DEPO)
        created_at      TEXT DEFAULT (datetime('now','localtime')),
        FOREIGN KEY(product_barcode) REFERENCES products(barcode) ON DELETE RESTRICT
      );
      CREATE TABLE IF NOT EXISTS options (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        kind       TEXT NOT NULL,           -- 'CATEGORY' | 'COLOR' | 'SIZE'
        value      TEXT NOT NULL,
        sort       INTEGER DEFAULT 0,
        is_active  INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(kind, value)
      );

      CREATE TABLE IF NOT EXISTS _meta (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS categories (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        is_active  INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS colors (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        is_active  INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );

      CREATE TABLE IF NOT EXISTS sizes (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        sort_order INTEGER DEFAULT 0,
        is_active  INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now','localtime'))
      );
      "#,
    )
    .map_err(|e| e.to_string())?;

  ensure_column(conn, "products", "product_code", "TEXT")?;
  ensure_column(conn, "products", "category", "TEXT")?;
  ensure_column(conn, "products", "color", "TEXT")?;
  ensure_column(conn, "products", "size", "TEXT")?;
  ensure_column(conn, "products", "buy_price", "REAL DEFAULT 0")?;
  ensure_column(conn, "products", "sell_price", "REAL NOT NULL DEFAULT 0")?;
  ensure_column(conn, "products", "stock", "INTEGER DEFAULT 0")?;
  ensure_column(conn, "products", "created_at", "TEXT DEFAULT (datetime('now','localtime'))")?;
  ensure_column(conn, "products", "updated_at", "TEXT DEFAULT (datetime('now','localtime'))")?;
  ensure_column(conn, "products", "is_active", "INTEGER DEFAULT 1")?;
  ensure_column(conn, "products", "category_id", "INTEGER")?;
  ensure_column(conn, "products", "color_id", "INTEGER")?;
  ensure_column(conn, "products", "size_id", "INTEGER")?;

  ensure_column(conn, "sales", "product_barcode", "TEXT")?;
  ensure_column(conn, "sales", "qty", "INTEGER DEFAULT 0")?;
  ensure_column(conn, "sales", "unit_price", "REAL DEFAULT 0")?;
  ensure_column(conn, "sales", "total", "REAL DEFAULT 0")?;
  ensure_column(conn, "sales", "sold_at", "TEXT DEFAULT (datetime('now','localtime'))")?;
  ensure_column(conn, "sales", "payment_method", "TEXT NOT NULL DEFAULT 'CARD'")?;
  ensure_column(conn, "sales", "note", "TEXT")?;

  ensure_column(conn, "sales", "sale_group_id", "TEXT")?;
  ensure_column(conn, "sales", "sold_from", "TEXT")?;
  ensure_column(conn, "sales", "list_price", "REAL DEFAULT 0")?;
  ensure_column(conn, "sales", "discount_amount", "REAL DEFAULT 0")?;
  ensure_column(conn, "sales", "voided", "INTEGER DEFAULT 0")?;

  ensure_column(conn, "products", "magaza_baslangic", "INTEGER DEFAULT 0")?;
  ensure_column(conn, "products", "depo_baslangic", "INTEGER DEFAULT 0")?;
  ensure_column(conn, "products", "magaza_stok", "INTEGER DEFAULT 0")?;
  ensure_column(conn, "products", "depo_stok", "INTEGER DEFAULT 0")?;

  ensure_column(conn, "expenses", "period", "TEXT")?;
  ensure_column(conn, "returns", "diff_payment_method", "TEXT")?;
  // dictionary tables (soft delete)
  ensure_column(conn, "categories", "is_active", "INTEGER DEFAULT 1")?;
  ensure_column(conn, "colors", "is_active", "INTEGER DEFAULT 1")?;
  ensure_column(conn, "sizes", "is_active", "INTEGER DEFAULT 1")?;

  // sizes: legacy order_no -> new sort_order (both can live)
  ensure_column(conn, "sizes", "sort_order", "INTEGER DEFAULT 0")?;

  ensure_returns_cascade_triggers(conn)?;

  Ok(())
}

fn ensure_column(conn: &Connection, table: &str, col: &str, col_def: &str) -> Result<(), String> {
  let mut stmt = conn
    .prepare(&format!("PRAGMA table_info({});", table))
    .map_err(|e| e.to_string())?;

  let existing: Vec<String> = stmt
    .query_map([], |row| row.get::<_, String>(1))
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

  if !existing.iter().any(|c| c == col) {
    conn
      .execute(
        &format!("ALTER TABLE {} ADD COLUMN {} {}", table, col, col_def),
        [],
      )
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}
fn col_for_loc(loc: &str) -> &'static str {
  match loc.to_uppercase().as_str() {
    "DEPO" => "depo_stok",
    _ => "magaza_stok",
  }
}

fn gen_group_id(prefix: &str) -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let ms = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
  format!("{}{}", prefix, ms)
}
fn seed_option_tables(conn: &Connection) -> Result<(), String> {
  // Bu fonksiyon sadece ilk migration/kurulum için: sözlük tabloları zaten doluysa
  // eski options/products değerleri yeni sözlüklere tekrar tekrar basılmasın.
  let cat_count: i64 = conn
    .query_row("SELECT COALESCE(COUNT(*),0) FROM categories", [], |r| r.get(0))
    .unwrap_or(0);
  let color_count: i64 = conn
    .query_row("SELECT COALESCE(COUNT(*),0) FROM colors", [], |r| r.get(0))
    .unwrap_or(0);
  let size_count: i64 = conn
    .query_row("SELECT COALESCE(COUNT(*),0) FROM sizes", [], |r| r.get(0))
    .unwrap_or(0);

  // Eğer en az bir sözlük tablosu doluysa, legacy seed'i tamamen atla.
  if cat_count > 0 || color_count > 0 || size_count > 0 {
    return Ok(());
  }

  // options -> categories
  conn.execute(
    r#"
    INSERT OR IGNORE INTO categories(name, is_active)
    SELECT value, 1 FROM options
    WHERE COALESCE(is_active,1)=1 AND UPPER(kind)='CATEGORY'
    "#,
    [],
  ).map_err(|e| e.to_string())?;

  // options -> colors
  conn.execute(
    r#"
    INSERT OR IGNORE INTO colors(name, is_active)
    SELECT value, 1 FROM options
    WHERE COALESCE(is_active,1)=1 AND UPPER(kind)='COLOR'
    "#,
    [],
  ).map_err(|e| e.to_string())?;

  // options -> sizes (sort_order: options.sort)
  conn.execute(
    r#"
    INSERT OR IGNORE INTO sizes(name, sort_order, is_active)
    SELECT value, COALESCE(sort,0), 1 FROM options
    WHERE COALESCE(is_active,1)=1 AND UPPER(kind)='SIZE'
    "#,
    [],
  ).map_err(|e| e.to_string())?;
  conn.execute(r#"
  INSERT OR IGNORE INTO categories(name, is_active)
  SELECT DISTINCT TRIM(category), 1
  FROM products
  WHERE category IS NOT NULL AND TRIM(category) <> ''
  "#, []).map_err(|e| e.to_string())?;

  conn.execute(r#"
  INSERT OR IGNORE INTO colors(name, is_active)
  SELECT DISTINCT TRIM(color), 1
  FROM products
  WHERE color IS NOT NULL AND TRIM(color) <> ''
  "#, []).map_err(|e| e.to_string())?;

  conn.execute(r#"
  INSERT OR IGNORE INTO sizes(name, sort_order, is_active)
  SELECT DISTINCT TRIM(size), 0, 1
  FROM products
  WHERE size IS NOT NULL AND TRIM(size) <> ''
  "#, []).map_err(|e| e.to_string())?;

  conn.execute(r#"
  UPDATE products
  SET category_id = (SELECT id FROM categories WHERE name = TRIM(products.category))
  WHERE (category_id IS NULL OR category_id = 0)
    AND category IS NOT NULL AND TRIM(category) <> ''
  "#, []).map_err(|e| e.to_string())?;

  conn.execute(r#"
  UPDATE products
  SET color_id = (SELECT id FROM colors WHERE name = TRIM(products.color))
  WHERE (color_id IS NULL OR color_id = 0)
    AND color IS NOT NULL AND TRIM(color) <> ''
  "#, []).map_err(|e| e.to_string())?;

  conn.execute(r#"
  UPDATE products
  SET size_id = (SELECT id FROM sizes WHERE name = TRIM(products.size))
  WHERE (size_id IS NULL OR size_id = 0)
    AND size IS NOT NULL AND TRIM(size) <> ''
  "#, []).map_err(|e| e.to_string())?;

  // backfill legacy order_no if column exists (ignore errors)
  let _ = conn.execute(
    r#"
    UPDATE sizes
    SET order_no = COALESCE(order_no, sort_order)
    WHERE order_no IS NULL
    "#,
    [],
  );

  Ok(())
}

#[derive(serde::Deserialize)]
pub struct CreateSaleItemPayload {
  pub barcode: String,
  pub qty: i64,
  pub list_price: f64,
  pub discount_amount: f64,
  pub unit_price: f64,
  pub sold_from: String,
}



#[derive(serde::Serialize)]
pub struct CreateSaleResult {
  pub sale_group_id: String,
  pub total: f64,
  pub lines: i64,
}

#[derive(serde::Serialize)]
pub struct UndoLastSaleResult {
  pub sale_group_id: String,
  pub restored_lines: i64,
}
//satışlar
#[derive(serde::Serialize)]
pub struct SaleGroupRow {
  pub sale_group_id: String,
  pub sold_at: String,  
  pub qty: i64,         
  pub total: f64,       
  pub payment_method: String,
  pub kind: String, 
}

#[derive(serde::Serialize)]
pub struct SaleLineRow {
  pub id: i64,
  pub sale_group_id: String,
  pub product_barcode: String,
  pub name: String,
  pub qty: i64,

  pub list_price: f64,        
  pub discount_amount: f64,   
  pub unit_price: f64,        
  pub total: f64,

  pub sold_at: String,
  pub sold_from: String,
  pub payment_method: String,
  pub refunded_qty: i64,
  pub refund_kind: Option<String>,
}
#[derive(serde::Serialize)]
pub struct CashReportRow {
  pub day: String,            
  pub cash_sales: f64,        
  pub card_sales: f64,        
  pub cash_refunds: f64,      
  pub card_refunds: f64,      
  pub cash_net: f64,          
  pub card_net: f64,         
  pub net_total: f64,         
}

fn pm_bucket(pm: &str) -> &'static str {
  let t = pm.trim().to_uppercase();
  if t == "CASH" || t == "NAKIT" || t == "NAKİT" { "CASH" } else { "CARD" }
}

// Günlük kasa raporu
pub fn get_cash_report(days: i64) -> Result<Vec<CashReportRow>, String> {
  let conn = get_conn()?;

  use std::collections::BTreeMap;
  let mut map: BTreeMap<String, CashReportRow> = BTreeMap::new();

  // 1) SATIŞLAR 
  let mut stmt_sales = conn
  .prepare(
    r#"
    SELECT
      date(sold_at) AS d,
      COALESCE(payment_method,'CARD') AS pm,
      SUM(total) AS sum_total
    FROM sales
    WHERE (
      COALESCE(voided,0)=0
      OR EXISTS (
        SELECT 1
        FROM return_items ri
        JOIN returns r ON r.return_group_id = ri.return_group_id
        WHERE r.mode = 'EXCHANGE'
          AND ri.ref_sale_id = sales.id
      )
    )
    AND date(sold_at) >= date('now','localtime', printf('-%d day', ?1))
    GROUP BY d, pm
    ORDER BY d ASC
    "#,
  )
  .map_err(|e| e.to_string())?;

  let sales_rows = stmt_sales
    .query_map(params![days], |r| {
      let d: String = r.get(0)?;
      let pm: String = r.get(1)?;
      let sum_total: f64 = r.get(2)?;
      Ok((d, pm, sum_total))
    })
    .map_err(|e| e.to_string())?;

  for row in sales_rows {
    let (d, pm, sum_total) = row.map_err(|e| e.to_string())?;
    let entry = map.entry(d.clone()).or_insert(CashReportRow {
      day: d.clone(),
      cash_sales: 0.0,
      card_sales: 0.0,
      cash_refunds: 0.0,
      card_refunds: 0.0, 
      cash_net: 0.0,
      card_net: 0.0,
      net_total: 0.0,
    });

    match pm_bucket(&pm) {
      "CASH" => entry.cash_sales += sum_total,
      _ => entry.card_sales += sum_total,
    }
  }

  // 2) İADELER (REFUND) 
  let mut stmt_refund = conn
    .prepare(
      r#"
      SELECT
        date(created_at) AS d,
        SUM(COALESCE(returned_total,0)) AS sum_total
      FROM returns
      WHERE mode='REFUND'
        AND date(created_at) >= date('now','localtime', printf('-%d day', ?1))
      GROUP BY d
      ORDER BY d ASC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let refund_rows = stmt_refund
    .query_map(params![days], |r| {
      let d: String = r.get(0)?;
      let sum_total: f64 = r.get(1)?;
      Ok((d, sum_total))
    })
    .map_err(|e| e.to_string())?;

  for row in refund_rows {
    let (d, sum_total) = row.map_err(|e| e.to_string())?;
    let entry = map.entry(d.clone()).or_insert(CashReportRow {
      day: d.clone(),
      cash_sales: 0.0,
      card_sales: 0.0,
      cash_refunds: 0.0,
      card_refunds: 0.0,
      cash_net: 0.0,
      card_net: 0.0,
      net_total: 0.0,
    });

    entry.cash_refunds += sum_total; 
  }

  // 3) DEĞİŞİM FARKI 
  let mut stmt_ex_pos = conn
    .prepare(
      r#"
      SELECT
        date(created_at) AS d,
        COALESCE(diff_payment_method,'CARD') AS pm,
        SUM(diff) AS sum_diff
      FROM returns
      WHERE mode='EXCHANGE'
        AND diff > 0
        AND date(created_at) >= date('now','localtime', printf('-%d day', ?1))
      GROUP BY d, pm
      ORDER BY d ASC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let ex_pos_rows = stmt_ex_pos
    .query_map(params![days], |r| {
      let d: String = r.get(0)?;
      let pm: String = r.get(1)?;
      let sum_diff: f64 = r.get(2)?;
      Ok((d, pm, sum_diff))
    })
    .map_err(|e| e.to_string())?;

  for row in ex_pos_rows {
    let (d, pm, sum_diff) = row.map_err(|e| e.to_string())?;
    let entry = map.entry(d.clone()).or_insert(CashReportRow {
      day: d.clone(),
      cash_sales: 0.0,
      card_sales: 0.0,
      cash_refunds: 0.0,
      card_refunds: 0.0,
      cash_net: 0.0,
      card_net: 0.0,
      net_total: 0.0,
    });

    match pm_bucket(&pm) {
      "CASH" => entry.cash_sales += sum_diff, 
      _ => entry.card_sales += sum_diff,
    }
  }

  // 4) DEĞİŞİM FARKI 
  let mut stmt_ex_neg = conn
    .prepare(
      r#"
      SELECT
        date(created_at) AS d,
        SUM(-diff) AS sum_out
      FROM returns
      WHERE mode='EXCHANGE'
        AND diff < 0
        AND date(created_at) >= date('now','localtime', printf('-%d day', ?1))
      GROUP BY d
      ORDER BY d ASC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let ex_neg_rows = stmt_ex_neg
    .query_map(params![days], |r| {
      let d: String = r.get(0)?;
      let sum_out: f64 = r.get(1)?;
      Ok((d, sum_out))
    })
    .map_err(|e| e.to_string())?;

  for row in ex_neg_rows {
    let (d, sum_out) = row.map_err(|e| e.to_string())?;
    let entry = map.entry(d.clone()).or_insert(CashReportRow {
      day: d.clone(),
      cash_sales: 0.0,
      card_sales: 0.0,
      cash_refunds: 0.0,
      card_refunds: 0.0,
      cash_net: 0.0,
      card_net: 0.0,
      net_total: 0.0,
    });

    entry.cash_refunds += sum_out; 
  }

  // 5) net hesapla 
  for (_, v) in map.iter_mut() {
    v.cash_net = v.cash_sales - v.cash_refunds;
    v.card_net = v.card_sales - v.card_refunds;
    v.net_total = v.cash_net + v.card_net;
  }

  Ok(map.into_values().collect())
}
/*
fn like(s: &str) -> String {
  format!("%{}%", s.trim())
}*/
pub fn list_sale_groups(days: i64, q: Option<String>) -> Result<Vec<SaleGroupRow>, String> {
  let conn = get_conn()?;
  let days = days.clamp(1, 365);

  let q_like: Option<String> = q
    .and_then(|s| {
      let t = s.trim().to_string();
      if t.is_empty() { None } else { Some(t) }
    })
    .map(|t| format!("%{}%", t));

  let mut out: Vec<SaleGroupRow> = Vec::new();

  // NORMAL SATIŞ FİŞLERİ
  let mut stmt_sales = conn
    .prepare(
      r#"
      SELECT
        s.sale_group_id,
        MAX(s.sold_at) as sold_at,
        SUM(s.qty) as qty,
        SUM(s.total) as total,
        MAX(COALESCE(s.payment_method,'CARD')) as payment_method
      FROM sales s
      WHERE COALESCE(s.voided,0)=0
        AND s.sale_group_id IS NOT NULL
        AND s.sold_at >= datetime('now','localtime', printf('-%d day', ?1))
        AND (?2 IS NULL OR EXISTS (
          SELECT 1
          FROM sales s2
          LEFT JOIN products p2 ON p2.barcode = s2.product_barcode
          WHERE s2.sale_group_id = s.sale_group_id
            AND (
              TRIM(s2.product_barcode) LIKE TRIM(?2)
              OR COALESCE(p2.name,'') LIKE ?2
            )
        ))
      GROUP BY s.sale_group_id
      ORDER BY MAX(s.sold_at) DESC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt_sales
    .query_map(rusqlite::params![days, q_like], |r| {
      Ok(SaleGroupRow {
        sale_group_id: r.get(0)?,
        sold_at: r.get(1)?,
        qty: r.get(2)?,
        total: r.get(3)?,
        payment_method: r.get(4)?,
        kind: "SALE".to_string(),
      })
    })
    .map_err(|e| e.to_string())?;

  for r in rows {
    out.push(r.map_err(|e| e.to_string())?);
  }

  // DEĞİŞİM FİŞLERİ
  let mut stmt_exchange = conn
    .prepare(
      r#"
      SELECT
        r.return_group_id,
        r.created_at,
        SUM(ei.qty) as qty,
        SUM(ei.total) as total,
        COALESCE(r.diff_payment_method,'CARD') as payment_method
      FROM returns r
      JOIN exchange_items ei ON ei.exchange_group_id = r.return_group_id
      WHERE r.mode='EXCHANGE'
        AND r.created_at >= datetime('now','localtime', printf('-%d day', ?1))
        AND (?2 IS NULL OR EXISTS (
          SELECT 1
          FROM exchange_items ei2
          LEFT JOIN products p2 ON p2.barcode = ei2.product_barcode
          WHERE ei2.exchange_group_id = r.return_group_id
            AND (
              TRIM(ei2.product_barcode) LIKE TRIM(?2)
              OR COALESCE(p2.name,'') LIKE ?2
            )
        ))
      GROUP BY r.return_group_id
      ORDER BY r.created_at DESC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt_exchange
    .query_map(rusqlite::params![days, q_like], |r| {
      Ok(SaleGroupRow {
        sale_group_id: r.get(0)?,
        sold_at: r.get(1)?,
        qty: r.get(2)?,
        total: r.get(3)?,
        payment_method: r.get(4)?,
        kind: "EXCHANGE".to_string(),
      })
    })
    .map_err(|e| e.to_string())?;

  for r in rows {
    out.push(r.map_err(|e| e.to_string())?);
  }

  // Tarihe göre tek listede sırala
  out.sort_by(|a, b| b.sold_at.cmp(&a.sold_at));

  Ok(out)
}
pub fn list_sales_by_group(sale_group_id: &str) -> Result<Vec<SaleLineRow>, String> {
  let conn = get_conn()?;

  // Normal satış fişi 
  if sale_group_id.starts_with('S') {
    let mut st = conn
      .prepare(
        r#"
        SELECT
          s.id,
          s.sale_group_id,
          s.product_barcode,
          COALESCE(p.name,'') AS name,
          s.qty,
          COALESCE(s.list_price,0) AS list_price,
          COALESCE(s.discount_amount,0) AS discount_amount,
          s.unit_price,
          s.total,
          s.sold_at,
          COALESCE(s.sold_from,'MAGAZA') AS sold_from,
          COALESCE(s.payment_method,'CARD') AS payment_method,
          (
            SELECT COALESCE(SUM(ri.qty), 0)
            FROM return_items ri
            WHERE ri.ref_sale_id = s.id
          ) AS refunded_qty
           ,(
            SELECT
              CASE
                WHEN MAX(CASE WHEN COALESCE(ri.return_group_id,'') LIKE 'E%' THEN 1 ELSE 0 END) = 1 THEN 'EXCHANGE'
                WHEN COALESCE(SUM(ri.qty),0) > 0 THEN 'REFUND'
                ELSE NULL
              END
            FROM return_items ri
            WHERE ri.ref_sale_id = s.id
          ) AS refund_kind
        FROM sales s
        LEFT JOIN products p ON p.barcode = s.product_barcode
        WHERE s.sale_group_id = ?1
          AND COALESCE(s.voided,0)=0
        ORDER BY s.id ASC
        "#,
      )
      .map_err(|e| e.to_string())?;

    let rows = st
      .query_map(rusqlite::params![sale_group_id], |r| {
        Ok(SaleLineRow {
          id: r.get(0)?,
          sale_group_id: r.get(1)?,
          product_barcode: r.get(2)?,
          name: r.get(3)?,
          qty: r.get(4)?,
          list_price: r.get(5)?,
          discount_amount: r.get(6)?,
          unit_price: r.get(7)?,
          total: r.get(8)?,
          sold_at: r.get(9)?,
          sold_from: r.get(10)?,
          payment_method: r.get(11)?,
          refunded_qty: r.get::<_, Option<i64>>(12)?.unwrap_or(0),
          refund_kind: r.get::<_, Option<String>>(13)?,
        })
      })
      .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for x in rows {
      out.push(x.map_err(|e| e.to_string())?);
    }
    return Ok(out);
  }

  // Değişim fişi 
  if sale_group_id.starts_with('E') {
    let mut st = conn
      .prepare(
        r#"
        SELECT
          ei.id,
          ei.exchange_group_id AS sale_group_id,
          ei.product_barcode,
          COALESCE(p.name,'') AS name,
          ei.qty,
          0.0 AS list_price,
          0.0 AS discount_amount,
          ei.unit_price,
          ei.total,
          r.created_at AS sold_at,
          COALESCE(ei.sold_from,'MAGAZA') AS sold_from,
          COALESCE(r.diff_payment_method,'CARD') AS payment_method
        FROM exchange_items ei
        JOIN returns r ON r.return_group_id = ei.exchange_group_id
        LEFT JOIN products p ON p.barcode = ei.product_barcode
        WHERE ei.exchange_group_id = ?1
        ORDER BY ei.id ASC
        "#,
      )
      .map_err(|e| e.to_string())?;

    let rows = st
      .query_map(rusqlite::params![sale_group_id], |r| {
        Ok(SaleLineRow {
          id: r.get(0)?,
          sale_group_id: r.get(1)?,
          product_barcode: r.get(2)?,
          name: r.get(3)?,
          qty: r.get(4)?,
          list_price: r.get(5)?,
          discount_amount: r.get(6)?,
          unit_price: r.get(7)?,
          total: r.get(8)?,
          sold_at: r.get(9)?,
          sold_from: r.get(10)?,
          payment_method: r.get(11)?,
          refunded_qty: 0,
          refund_kind: Some("EXCHANGE".to_string()),
        })
      })
      .map_err(|e| e.to_string())?;

    let mut out = Vec::new();
    for x in rows {
      out.push(x.map_err(|e| e.to_string())?);
    }
    return Ok(out);
  }

  Ok(vec![])
}
//satışlar bitti

pub fn create_sale(payload: CreateSalePayload) -> Result<CreateSaleResult, String> {
  if payload.items.is_empty() {
    return Err("Sepet boş".to_string());
  }

  let mut conn = get_conn()?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  let sale_group_id = format!("S{}", chrono_like_id());

  let pm_raw = payload.payment_method.trim();
  let pm_up = if pm_raw.is_empty() { "CARD" } else { pm_raw }.to_uppercase();

  let pm = match pm_up.as_str() {
    "CARD" | "KART" => "CARD",
    "CASH" | "NAKIT" | "NAKİT" => "CASH",
    "TRANSFER" | "HAVALE" | "EFT" => "TRANSFER",
    _ => "CARD",
  };

  use std::collections::HashMap;

  let mut need: HashMap<(String, String), i64> = HashMap::new();
  for it in &payload.items {
    let qty = if it.qty <= 0 { 1 } else { it.qty };
    let sold_from = if it.sold_from.trim().is_empty() {
      let d = payload.sold_from_default.trim();
      if d.is_empty() { "MAGAZA".to_string() } else { payload.sold_from_default.clone() }
    } else {
      it.sold_from.clone()
    };

    *need.entry((it.barcode.clone(), sold_from)).or_insert(0) += qty;
  }

  for ((bc, sold_from), q) in need.iter() {
    let col = col_for_loc(sold_from);
    let sql = format!("SELECT COALESCE({}, 0) FROM products WHERE barcode = ?1", col);

    let loc_stock: i64 = tx
      .query_row(&sql, params![bc], |r| r.get(0))
      .optional()
      .map_err(|e| e.to_string())?
      .ok_or_else(|| format!("Ürün bulunamadı: {}", bc))?;

    if loc_stock < *q {
      return Err(format!(
        "Yetersiz stok: {} ({} stok: {}, istenen: {})",
        bc, sold_from, loc_stock, q
      ));
    }
  }

  let mut total: f64 = 0.0;
  let mut lines: i64 = 0;

  for it in payload.items {
    let qty = if it.qty <= 0 { 1 } else { it.qty };
    let list_price = if it.list_price.is_finite() { it.list_price } else { 0.0 };
    let discount_amount = if it.discount_amount.is_finite() { it.discount_amount } else { 0.0 };
    let unit_price = if it.unit_price.is_finite() { it.unit_price } else { 0.0 };

    let sold_from = if it.sold_from.trim().is_empty() {
      let d = payload.sold_from_default.trim();
      if d.is_empty() { "MAGAZA".to_string() } else { payload.sold_from_default.clone() }
    } else {
      it.sold_from.clone()
    };

    let col = col_for_loc(&sold_from);
    tx.execute(
      &format!(
        "UPDATE products SET {c} = COALESCE({c},0) - ?1, stock = COALESCE(stock,0) - ?1 WHERE barcode = ?2",
        c = col
      ),
      params![qty, &it.barcode],
    )
    .map_err(|e| e.to_string())?;

    let line_total = unit_price * qty as f64;
    total += line_total;
    lines += 1;

    tx.execute(
      r#"
      INSERT INTO sales (
        product_barcode, qty, unit_price, total, note,
        sale_group_id, sold_from, list_price, discount_amount, voided,
        payment_method, sold_at
      ) VALUES (
        ?1, ?2, ?3, ?4, NULL,
        ?5, ?6, ?7, ?8, 0,
        ?9, datetime('now','localtime')
      )
      "#,
      params![
        &it.barcode,
        qty,
        unit_price,
        line_total,
        &sale_group_id,
        &sold_from,
        list_price,
        discount_amount,
        pm
      ],
    )
    .map_err(|e| e.to_string())?;
  }

  tx.commit().map_err(|e| e.to_string())?;

  Ok(CreateSaleResult {
    sale_group_id,
    total,
    lines,
  })
}

pub fn undo_last_sale() -> Result<UndoLastSaleResult, String> {
  let mut conn = get_conn()?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  let last_group: Option<String> = tx
    .query_row(
      "SELECT sale_group_id FROM sales WHERE sale_group_id IS NOT NULL AND COALESCE(voided,0)=0 ORDER BY id DESC LIMIT 1",
      [],
      |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  let sale_group_id = last_group.ok_or_else(|| "Geri alınacak satış bulunamadı".to_string())?;

  let mut restored_lines: i64 = 0;
  {
    let mut stmt = tx
      .prepare(
        r#"
        SELECT product_barcode, qty, COALESCE(sold_from, 'MAGAZA') AS sold_from
        FROM sales
        WHERE sale_group_id = ?1 AND COALESCE(voided,0)=0
        "#,
      )
      .map_err(|e| e.to_string())?;

    let rows = stmt
      .query_map(params![&sale_group_id], |r| {
        Ok((
          r.get::<_, String>(0)?,
          r.get::<_, i64>(1)?,
          r.get::<_, String>(2)?,
        ))
      })
      .map_err(|e| e.to_string())?;

    for r in rows {
      let (bc, qty, sold_from) = r.map_err(|e| e.to_string())?;
      let col = col_for_loc(&sold_from);

      tx.execute(
        &format!(
          "UPDATE products SET {c} = COALESCE({c},0) + ?1, stock = COALESCE(stock,0) + ?1 WHERE barcode = ?2",
          c = col
        ),
        params![qty, &bc],
      )
      .map_err(|e| e.to_string())?;

      restored_lines += 1;
    }
  }

  tx.execute(
  "DELETE FROM sales WHERE sale_group_id = ?1 AND COALESCE(voided,0)=0",
    params![&sale_group_id],
  )
  .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;

  Ok(UndoLastSaleResult {
    sale_group_id,
    restored_lines,
  })
}

fn chrono_like_id() -> String {
  use std::time::{SystemTime, UNIX_EPOCH};
  let ms = SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_millis();
  ms.to_string()
}
#[derive(serde::Deserialize)]
pub struct CreateTransferItemPayload {
  pub barcode: String,
  pub qty: i64,
  pub from_loc: String, 
  pub to_loc: String,   
}

#[derive(serde::Deserialize)]
pub struct CreateTransferPayload {
  pub items: Vec<CreateTransferItemPayload>,
  pub note: Option<String>,
}

#[derive(serde::Serialize)]
pub struct CreateTransferResult {
  pub transfer_group_id: String,
  pub lines: i64,
}

#[derive(serde::Serialize)]
pub struct UndoLastTransferResult {
  pub transfer_group_id: String,
  pub restored_lines: i64,
}

//----------------GİDERLER--------------------
#[derive(serde::Serialize)]
pub struct Expense {
  pub id: i64,
  pub spent_at: String,
  pub period: Option<String>,
  pub category: Option<String>,
  pub amount: f64,
  pub note: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct CreateSalePayload {
  pub items: Vec<CreateSaleItemPayload>,
  pub sold_from_default: String,
  pub payment_method: String, 
}

pub fn list_expenses() -> Result<Vec<Expense>, String> {
  let conn = get_conn()?;

  let mut stmt = conn
    .prepare(
      r#"
      SELECT
        id,
        spent_at,
        period,
        category,
        amount,
        note
      FROM expenses
      ORDER BY spent_at DESC, id DESC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map([], |row| {
      Ok(Expense {
        id: row.get(0)?,
        spent_at: row.get(1)?,
        period: row.get(2)?,
        category: row.get(3)?,
        amount: row.get(4)?,
        note: row.get(5)?,
      })
    })
    .map_err(|e| e.to_string())?;

  let mut out = Vec::new();
  for r in rows {
    out.push(r.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

pub fn add_expense(
  spent_at: String,
  period: Option<String>,
  category: Option<String>,
  amount: f64,
  note: Option<String>,
) -> Result<i64, String> {
  if !amount.is_finite() || amount <= 0.0 {
    return Err("Tutar 0'dan büyük sayı olmalı".to_string());
  }
  if spent_at.trim().is_empty() {
    return Err("Tarih zorunlu".to_string());
  }

  let conn = get_conn()?;

  conn.execute(
    r#"
    INSERT INTO expenses (title, amount, spent_at, category, note, period)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6)
    "#,
    rusqlite::params![
      "Gider",
      amount,
      spent_at.trim(),
      category,
      note,
      period
    ],
  )
  .map_err(|e| e.to_string())?;

  Ok(conn.last_insert_rowid())
}

pub fn delete_expense(id: i64) -> Result<i64, String> {
  let conn = get_conn()?;
  let changed = conn
    .execute("DELETE FROM expenses WHERE id = ?1", rusqlite::params![id])
    .map_err(|e| e.to_string())?;
  Ok(changed as i64)
}


// -------------------- DASHBOARD --------------------

#[derive(serde::Serialize)]
pub struct DashboardKpi {
  pub today_qty: i64,
  pub today_net_revenue: f64,
  pub month_gross_profit: f64,
  pub month_net_profit: f64,
  pub month_avg_basket: f64,
  pub month_expense: f64,
}

#[derive(serde::Serialize)]
pub struct DailyDashboardRow {
  pub day: String, 
  pub net_qty: i64,
  pub net_revenue: f64,
  pub gross_profit: f64,
  pub avg_basket: f64,
}

#[derive(serde::Serialize)]
pub struct MonthlyDashboardRow {
  pub period: String, 
  pub net_qty: i64,
  pub net_revenue: f64,
  pub gross_profit: f64,
  pub expense: f64,
  pub net_profit: f64,
  pub avg_basket: f64,
}

#[derive(serde::Serialize)]
pub struct DashboardSummary {
  pub kpi: DashboardKpi,
  pub daily: Vec<DailyDashboardRow>,
  pub monthly: Vec<MonthlyDashboardRow>,
}

// -------------------- RETURN / EXCHANGE --------------------

pub fn list_sales_by_barcode(barcode: &str, days: i64) -> Result<Vec<SaleLine>, String> {
  let conn = get_conn()?;
  let offset = format!("-{} days", days.max(0));

  let mut stmt = conn
    .prepare(
      r#"
      SELECT
        s.sold_at,
        s.qty,
        s.unit_price,
        s.total,
        COALESCE(s.sold_from, 'MAGAZA') AS sold_from,
        (
          SELECT COALESCE(SUM(ri.qty), 0)
          FROM return_items ri
          WHERE ri.ref_sale_id = s.id
        ) AS refunded_qty
      FROM sales s
      WHERE TRIM(s.product_barcode) = TRIM(?1)
        AND COALESCE(s.voided, 0) = 0
        AND s.sold_at >= datetime('now', ?2)
      ORDER BY s.sold_at DESC
      "#,
    )
    .map_err(|e| e.to_string())?;

  let rows = stmt
    .query_map(params![barcode, offset], |row| {
      Ok(SaleLine {
        sold_at: row.get(0)?,
        qty: row.get(1)?,
        unit_price: row.get(2)?,
        total: row.get(3)?,
        sold_from: row.get(4)?,
        refunded_qty: row.get::<_, Option<i64>>(5)?.unwrap_or(0),
      })
    })
    .map_err(|e| e.to_string())?;

  let mut out = Vec::new();
  for r in rows {
    out.push(r.map_err(|e| e.to_string())?);
  }
  Ok(out)
}

pub fn create_return(payload: CreateReturnPayload) -> Result<CreateReturnResult, String> {
  if payload.qty <= 0 {
    return Err("İade adedi 1+ olmalı".to_string());
  }

  let mut conn = get_conn()?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  let ref_sale_id: Option<i64> = match payload.sold_at.as_deref() {
    Some(sold_at) => tx
      .query_row(
        "SELECT id FROM sales WHERE TRIM(product_barcode) = TRIM(?1) AND sold_at = ?2 AND COALESCE(voided,0)=0 ORDER BY id DESC LIMIT 1",
        params![&payload.barcode, sold_at],
        |r| r.get(0),
      )
      .optional()
      .map_err(|e| e.to_string())?,
    None => None,
  };
  // Kısmi iade: referans satıştan kalan adet kontrolü
  if let Some(ref_id) = ref_sale_id {
    let sold_qty: i64 = tx
      .query_row(
        "SELECT qty FROM sales WHERE id = ?1 AND COALESCE(voided,0)=0",
        params![ref_id],
        |r| r.get(0),
      )
      .map_err(|e| e.to_string())?;

    let already_refunded: i64 = tx
      .query_row(
        "SELECT COALESCE(SUM(qty),0) FROM return_items WHERE ref_sale_id = ?1",
        params![ref_id],
        |r| r.get(0),
      )
      .map_err(|e| e.to_string())?;

    let remaining = sold_qty - already_refunded;

    if remaining <= 0 {
      return Err("Bu satış satırı daha önce tamamen iade edilmiş".to_string());
    }
    if payload.qty > remaining {
      return Err(format!(
        "İade adedi satıştan fazla olamaz (satılan: {}, daha önce iade: {}, kalan: {})",
        sold_qty, already_refunded, remaining
      ));
    }
  }

  let col = col_for_loc(&payload.return_to);
  tx.execute(
    &format!(
      "UPDATE products SET {c} = COALESCE({c},0) + ?1, stock = COALESCE(stock,0) + ?1 WHERE barcode = ?2",
      c = col
    ),
    params![payload.qty, &payload.barcode],
  )
  .map_err(|e| e.to_string())?;

  let return_group_id = gen_group_id("R");
  let returned_total = payload.unit_price * payload.qty as f64;

  tx.execute(
    "INSERT INTO returns (return_group_id, mode, returned_total, given_total, diff) VALUES (?1, 'REFUND', ?2, 0, ?3)",
    params![&return_group_id, returned_total, -returned_total],
  )
  .map_err(|e| e.to_string())?;

  tx.execute(
    r#"
    INSERT INTO return_items (
      return_group_id, product_barcode, qty, unit_price, total,
      return_to, ref_sale_id, ref_sold_at, ref_sold_from
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    "#,
    params![
      &return_group_id,
      &payload.barcode,
      payload.qty,
      payload.unit_price,
      returned_total,
      &payload.return_to,
      ref_sale_id,
      payload.sold_at,
      payload.sold_from
    ],
  )
  .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;

  Ok(CreateReturnResult {
    return_group_id,
    lines: 1,
    returned_total,
  })
}

pub fn create_exchange(payload: CreateExchangePayload) -> Result<CreateExchangeResult, String> {
  if payload.returned.qty <= 0 {
    return Err("İade adedi 1+ olmalı".to_string());
  }
  if payload.given.is_empty() {
    return Err("Değişimde verilecek sepet boş".to_string());
  }

  let mut conn = get_conn()?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;


  for g in &payload.given {
    if g.qty <= 0 {
      continue;
    }

    let col = col_for_loc(&g.sold_from);
    let sql = format!("SELECT COALESCE({}, 0) FROM products WHERE barcode = ?1", col);

    let loc_stock: i64 = tx
      .query_row(&sql, params![&g.barcode], |r| r.get::<_, i64>(0))
      .optional()
      .map_err(|e| e.to_string())?
      .ok_or_else(|| format!("Ürün bulunamadı: {}", g.barcode))?;

    if loc_stock < g.qty {
      return Err(format!(
        "Yetersiz stok: {} ({} stok: {}, istenen: {})",
        g.barcode,
        g.sold_from,
        loc_stock,
        g.qty
      ));
    }
  }

  let ref_sale_id: Option<i64> = match payload.returned.sold_at.as_deref() {
    Some(sold_at) => tx
      .query_row(
        "SELECT id FROM sales
         WHERE TRIM(product_barcode) = TRIM(?1)
           AND sold_at = ?2
           AND COALESCE(voided,0)=0
         ORDER BY id DESC
         LIMIT 1",
        params![&payload.returned.barcode, sold_at],
        |r| r.get(0),
      )
      .optional()
      .map_err(|e| e.to_string())?,
    None => None,
  };
  // Kısmi değişim: referans satıştan kalan adet kontrolü
  if let Some(ref_id) = ref_sale_id {
    let sold_qty: i64 = tx
      .query_row(
        "SELECT qty FROM sales WHERE id = ?1 AND COALESCE(voided,0)=0",
        params![ref_id],
        |r| r.get(0),
      )
      .map_err(|e| e.to_string())?;

    let already_refunded: i64 = tx
      .query_row(
        "SELECT COALESCE(SUM(qty),0) FROM return_items WHERE ref_sale_id = ?1",
        params![ref_id],
        |r| r.get(0),
      )
      .map_err(|e| e.to_string())?;

    let remaining = sold_qty - already_refunded;

    if remaining <= 0 {
      return Err("Bu satış satırı daha önce tamamen iade/değişim yapılmış".to_string());
    }
    if payload.returned.qty > remaining {
      return Err(format!(
        "İade edilen adet satıştan fazla olamaz (satılan: {}, daha önce iade: {}, kalan: {})",
        sold_qty, already_refunded, remaining
      ));
    }
  }

  let exchange_group_id = format!("E{}", chrono_like_id());

  let return_col = col_for_loc(&payload.returned.return_to);
  tx.execute(
    &format!(
      "UPDATE products
       SET {c} = COALESCE({c},0) + ?1,
           stock = COALESCE(stock,0) + ?1
       WHERE barcode = ?2",
      c = return_col
    ),
    params![payload.returned.qty, &payload.returned.barcode],
  )
  .map_err(|e| e.to_string())?;

  let returned_total_calc: f64 = payload.returned.unit_price * payload.returned.qty as f64;
  tx.execute(
    r#"
    INSERT INTO return_items (
      return_group_id, product_barcode, qty, unit_price, total,
      return_to, ref_sale_id, ref_sold_at, ref_sold_from
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    "#,
    params![
      &exchange_group_id,
      &payload.returned.barcode,
      payload.returned.qty,
      payload.returned.unit_price,
      returned_total_calc,
      &payload.returned.return_to,
      ref_sale_id,
      payload.returned.sold_at,
      payload.returned.sold_from
    ],
  )
  .map_err(|e| e.to_string())?;

  let mut given_total_calc: f64 = 0.0;
  let mut lines: i64 = 0;

  for it in &payload.given {
    if it.qty <= 0 {
      continue;
    }

    // stok düş: ilgili lokasyon + legacy stock
    let sold_col = col_for_loc(&it.sold_from);
    tx.execute(
      &format!(
        "UPDATE products
         SET {c} = COALESCE({c},0) - ?1,
             stock = COALESCE(stock,0) - ?1
         WHERE barcode = ?2",
        c = sold_col
      ),
      params![it.qty, &it.barcode],
    )
    .map_err(|e| e.to_string())?;

    let line_total = it.unit_price * it.qty as f64;
    given_total_calc += line_total;

    tx.execute(
      r#"
      INSERT INTO exchange_items (
        exchange_group_id, product_barcode, qty, unit_price, total, sold_from
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      "#,
      params![
        &exchange_group_id,
        &it.barcode,
        it.qty,
        it.unit_price,
        line_total,
        &it.sold_from
      ],
    )
    .map_err(|e| e.to_string())?;

    lines += 1;
  }

  let diff_calc: f64 = given_total_calc - returned_total_calc;

  let diff_pm_norm: Option<String> = if diff_calc > 0.0001 {
    let pm_raw = payload
      .summary
      .diff_payment_method
      .clone()
      .unwrap_or_else(|| "CASH".to_string());

    let pm_up = pm_raw.trim().to_uppercase();
    let pm = match pm_up.as_str() {
      "CARD" | "KART" => "CARD",
      "CASH" | "NAKIT" | "NAKİT" => "CASH",
      _ => {
        return Err(
          "diff_payment_method sadece CARD/KART veya CASH/NAKİT olabilir".to_string(),
        )
      }
    };

    Some(pm.to_string())
  } else {
    None
  };

  tx.execute(
    r#"
    INSERT INTO returns
      (return_group_id, mode, returned_total, given_total, diff, diff_payment_method, created_at)
    VALUES
      (?1, 'EXCHANGE', ?2, ?3, ?4, ?5, datetime('now','localtime'))
    "#,
    params![
      &exchange_group_id,
      returned_total_calc,
      given_total_calc,
      diff_calc,
      diff_pm_norm
    ],
  )
  .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;

  Ok(CreateExchangeResult {
    exchange_group_id,
    lines,
    returned_total: returned_total_calc,
    given_total: given_total_calc,
    diff: diff_calc,
  })
}

pub fn create_transfer(payload: CreateTransferPayload) -> Result<CreateTransferResult, String> {
  if payload.items.is_empty() {
    return Err("Sepet boş".to_string());
  }

  let mut conn = get_conn()?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  let transfer_group_id = format!("T{}", chrono_like_id());

  let note_norm: Option<String> = payload.note.as_ref().and_then(|s| {
    let t = s.trim();
    if t.is_empty() { None } else { Some(t.to_string()) }
  });

  use std::collections::HashMap;
  let mut need: HashMap<(String, String), i64> = HashMap::new(); 
  for it in &payload.items {
    let q = if it.qty <= 0 { 1 } else { it.qty };
    if it.from_loc == it.to_loc {
      return Err("Nereden ve nereye aynı olamaz".to_string());
    }
    *need.entry((it.barcode.clone(), it.from_loc.clone())).or_insert(0) += q;
  }

  for ((bc, from_loc), q) in need.iter() {
    let col = col_for_loc(from_loc);
    let sql = format!("SELECT COALESCE({},0) FROM products WHERE barcode = ?1", col);

    let stock: i64 = tx
      .query_row(&sql, params![bc], |r| r.get(0))
      .optional()
      .map_err(|e| e.to_string())?
      .ok_or_else(|| format!("Ürün bulunamadı: {}", bc))?;

    if stock < *q {
      return Err(format!(
        "Yetersiz stok: {} ({} stok: {}, istenen: {})",
        bc, from_loc, stock, q
      ));
    }
  }

  let mut lines: i64 = 0;
  for it in payload.items {
    let qty = if it.qty <= 0 { 1 } else { it.qty };
    if it.from_loc == it.to_loc {
      return Err("Nereden ve nereye aynı olamaz".to_string());
    }

    let from_col = col_for_loc(&it.from_loc);
    let to_col = col_for_loc(&it.to_loc);

    // 1) Kaynaktan düş
    tx.execute(
      &format!(
        "UPDATE products SET {c} = COALESCE({c},0) - ?1 WHERE barcode = ?2",
        c = from_col
      ),
      params![qty, &it.barcode],
    )
    .map_err(|e| e.to_string())?;

    // 2) Hedefe ekle
    tx.execute(
      &format!(
        "UPDATE products SET {c} = COALESCE({c},0) + ?1 WHERE barcode = ?2",
        c = to_col
      ),
      params![qty, &it.barcode],
    )
    .map_err(|e| e.to_string())?;

    // kayıt ekle (undo + rapor için)
    tx.execute(
      r#"
      INSERT INTO transfers (
        product_barcode, qty, from_loc, to_loc, transfer_group_id, note, transferred_at, voided
      ) VALUES (
        ?1, ?2, ?3, ?4, ?5, ?6, datetime('now','localtime'), 0
      )
      "#,
      params![
        &it.barcode,
        qty,
        it.from_loc.trim().to_uppercase(),
        it.to_loc.trim().to_uppercase(),
        &transfer_group_id,
        note_norm,
      ],
    )
    .map_err(|e| e.to_string())?;

    lines += 1;
  }

  tx.commit().map_err(|e| e.to_string())?;

  Ok(CreateTransferResult {
    transfer_group_id,
    lines,
  })
}

pub fn undo_last_transfer() -> Result<UndoLastTransferResult, String> {
  let mut conn = get_conn()?;
  let tx = conn.transaction().map_err(|e| e.to_string())?;

  let last_group: Option<String> = tx
    .query_row(
      "SELECT transfer_group_id FROM transfers WHERE COALESCE(voided,0)=0 AND transfer_group_id IS NOT NULL ORDER BY id DESC LIMIT 1",
      [],
      |r| r.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())?;

  let transfer_group_id =
    last_group.ok_or_else(|| "Geri alınacak transfer bulunamadı".to_string())?;

  let mut restored_lines: i64 = 0;

  {
    let mut stmt = tx
      .prepare(
        "SELECT product_barcode, qty, from_loc, to_loc
         FROM transfers
         WHERE transfer_group_id = ?1 AND COALESCE(voided,0)=0",
      )
      .map_err(|e| e.to_string())?;

    let rows = stmt
      .query_map(params![&transfer_group_id], |r| {
        Ok((
          r.get::<_, String>(0)?,
          r.get::<_, i64>(1)?,
          r.get::<_, String>(2)?,
          r.get::<_, String>(3)?,
        ))
      })
      .map_err(|e| e.to_string())?;

    for r in rows {
      let (bc, qty, from_loc, to_loc) = r.map_err(|e| e.to_string())?;

      // geri al
      let from_col = col_for_loc(&from_loc);
      let to_col = col_for_loc(&to_loc);

      tx.execute(
        &format!("UPDATE products SET {} = COALESCE({},0) - ?1 WHERE barcode = ?2", to_col, to_col),
        params![qty, &bc],
      )
      .map_err(|e| e.to_string())?;

      tx.execute(
        &format!("UPDATE products SET {} = COALESCE({},0) + ?1 WHERE barcode = ?2", from_col, from_col),
        params![qty, &bc],
      )
      .map_err(|e| e.to_string())?;

      restored_lines += 1;
    }
  }

  tx.execute(
    "UPDATE transfers SET voided = 1 WHERE transfer_group_id = ?1 AND COALESCE(voided,0)=0",
    params![&transfer_group_id],
  )
  .map_err(|e| e.to_string())?;

  tx.commit().map_err(|e| e.to_string())?;

  Ok(UndoLastTransferResult {
    transfer_group_id,
    restored_lines,
  })
}
fn ensure_returns_cascade_triggers(conn: &Connection) -> Result<(), String> {
  conn.execute_batch(
    r#"
      -- drop possible legacy/duplicate names first
      DROP TRIGGER IF EXISTS trg_returns_delete_return_items;
      DROP TRIGGER IF EXISTS trg_returns_delete_exchange_items;
      DROP TRIGGER IF EXISTS returns_delete_return_items;
      DROP TRIGGER IF EXISTS returns_delete_exchange_items;

      CREATE TRIGGER trg_returns_delete_return_items
      AFTER DELETE ON returns
      BEGIN
        DELETE FROM return_items WHERE return_group_id = OLD.return_group_id;
      END;

      CREATE TRIGGER trg_returns_delete_exchange_items
      AFTER DELETE ON returns
      BEGIN
        DELETE FROM exchange_items WHERE exchange_group_id = OLD.return_group_id;
      END;
    "#
  ).map_err(|e| e.to_string())?;
  Ok(())
}

fn seed_default_dictionaries(conn: &Connection) -> Result<(), String> {
  // Eğer tablolar boşsa (veya çok az kayıt varsa) default değerleri bas.
  // NOT: INSERT OR IGNORE + UNIQUE(name) sayesinde tekrar tekrar çalışsa da sorun olmaz.

  let cat_count: i64 = conn
    .query_row("SELECT COALESCE(COUNT(*),0) FROM categories", [], |r| r.get(0))
    .unwrap_or(0);
  let color_count: i64 = conn
    .query_row("SELECT COALESCE(COUNT(*),0) FROM colors", [], |r| r.get(0))
    .unwrap_or(0);
  let size_count: i64 = conn
    .query_row("SELECT COALESCE(COUNT(*),0) FROM sizes", [], |r| r.get(0))
    .unwrap_or(0);

  // kategori / ürün çeşidi
  if cat_count == 0 {
    let categories = vec![
      "ELBISE", "ÜST", "ALT", "DIŞ GİYİM", "TAKIM", "AKSESUAR",
    ];

    for name in categories {
      conn
        .execute(
          "INSERT OR IGNORE INTO categories (name, is_active, created_at) VALUES (?1, 1, datetime('now','localtime'))",
          params![name],
        )
        .map_err(|e| e.to_string())?;
    }
  }

  // renk
  if color_count == 0 {
    let colors = vec![
      "SIYAH", "BEYAZ", "KREM", "BEJ", "GRI", "LACIVERT",
      "KAHVERENGI", "BORDO", "YESIL", "MAVI", "PEMBE", "KIRMIZI",
      "MOR", "TURUNCU", "SARI",
    ];

    for name in colors {
      conn
        .execute(
          "INSERT OR IGNORE INTO colors (name, is_active, created_at) VALUES (?1, 1, datetime('now','localtime'))",
          params![name],
        )
        .map_err(|e| e.to_string())?;
    }
  }

  // beden (sort_order sıralama için)
  if size_count == 0 {
    let sizes: Vec<(&str, i64)> = vec![
      ("STD", 1000),("XS", 10), ("S", 20), ("M", 30), ("L", 40), ("XL", 50), ("XXL", 60),
      ("34", 110), ("36", 120), ("38", 130), ("40", 140), ("42", 150), ("44", 160), ("46", 170),
      
    ];

    for (name, so) in sizes {
      conn
        .execute(
          "INSERT OR IGNORE INTO sizes (name, sort_order, is_active, created_at) VALUES (?1, ?2, 1, datetime('now','localtime'))",
          params![name, so],
        )
        .map_err(|e| e.to_string())?;
    }
  }

  Ok(())
}