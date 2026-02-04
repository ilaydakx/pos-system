#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod backup;

use tauri::Manager;
use tauri_plugin_dialog;

// -------------------- INPUT NORMALIZATION --------------------

fn norm_opt(s: Option<String>) -> Option<String> {
  s.and_then(|v| {
    let t = v.trim().to_string();
    if t.is_empty() { None } else { Some(t) }
  })
}

fn norm_req(field: &str, s: String) -> Result<String, String> {
  let t = s.trim().to_string();
  if t.is_empty() {
    Err(format!("{} zorunlu (boş olamaz).", field))
  } else {
    Ok(t)
  }
}

fn norm_req_len(field: &str, s: String, max_len: usize) -> Result<String, String> {
  let t = norm_req(field, s)?;
  if t.chars().count() > max_len {
    Err(format!("{} çok uzun (max {}).", field, max_len))
  } else {
    Ok(t)
  }
}

fn norm_opt_q(s: Option<String>) -> Option<String> {
  // search params: trim, empty => None
  norm_opt(s)
}

fn normalize_payment_method(pm: Option<String>) -> String {
  let t = pm
    .as_deref()
    .map(|s| s.trim().to_uppercase())
    .unwrap_or_default();

  match t.as_str() {
    "CARD" | "CASH" | "TRANSFER" => t,
    "" => "CARD".to_string(),
    _ => "CARD".to_string(),
  }
}

// -------------------- PRODUCTS --------------------

#[derive(serde::Deserialize)]
struct AddProductPayload {
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
}

#[tauri::command]
fn ping_db() -> Result<String, String> {
  db::ping()
}

#[tauri::command]
fn list_products() -> Result<Vec<db::Product>, String> {
  db::list_products()
}

#[tauri::command]
fn find_product(barcode: String) -> Result<Option<db::Product>, String> {
  let bc = barcode.trim().to_string();
  if bc.is_empty() {
    return Err("barcode zorunlu (boş olamaz).".into());
  }
  db::find_product_by_barcode(&bc)
}

#[tauri::command]
fn delete_product(barcode: String) -> Result<i64, String> {
  let bc = barcode.trim().to_string();
  if bc.is_empty() {
    return Err("barcode zorunlu (boş olamaz).".into());
  }
  println!("[delete_product] called with barcode={}", bc);
  db::delete_product(&bc)
}
#[tauri::command]
fn add_product(payload: AddProductPayload) -> Result<CreatedProductDto, String> {
  // name zorunlu
  let name = norm_req_len("name", payload.name, 200)?;

  // opsiyonel alanlar: trim + empty => None
  let barcode_opt = norm_opt(payload.barcode);
  let product_code_opt = norm_opt(payload.product_code);
  let category_opt = norm_opt(payload.category);
  let color_opt = norm_opt(payload.color);
  let size_opt = norm_opt(payload.size);

  if payload.sell_price < 0.0 {
    return Err("sell_price negatif olamaz.".into());
  }
  if let Some(bp) = payload.buy_price {
    if bp < 0.0 {
      return Err("buy_price negatif olamaz.".into());
    }
  }

  let created = db::add_product(
    barcode_opt,
    product_code_opt,
    category_opt,
    name,
    color_opt,
    size_opt,
    payload.buy_price,
    payload.sell_price,
    payload.stock,
    payload.magaza_baslangic,
    payload.depo_baslangic,
  )?;

  Ok(CreatedProductDto {
    barcode: created.barcode,
    product_code: created.product_code,
  })
}
/*
#[tauri::command]
fn add_product(payload: AddProductPayload) -> Result<String, String> {
  // name zorunlu
  let name = norm_req_len("name", payload.name, 200)?;

  // opsiyonel alanlar: trim + empty => None
  let barcode_opt = norm_opt(payload.barcode);
  let product_code_opt = norm_opt(payload.product_code);
  let category_opt = norm_opt(payload.category);
  let color_opt = norm_opt(payload.color);
  let size_opt = norm_opt(payload.size);

  if payload.sell_price < 0.0 {
    return Err("sell_price negatif olamaz.".into());
  }
  if let Some(bp) = payload.buy_price {
    if bp < 0.0 {
      return Err("buy_price negatif olamaz.".into());
    }
  }

  db::add_product(
    barcode_opt,
    product_code_opt,
    category_opt,
    name,
    color_opt,
    size_opt,
    payload.buy_price,
    payload.sell_price,
    payload.stock,
    payload.magaza_baslangic,
    payload.depo_baslangic,
  )
}*/

#[tauri::command]
fn update_product(payload: db::UpdateProductPayload) -> Result<i64, String> {
  db::update_product(payload)
}
#[derive(serde::Serialize)]
pub struct CreatedProductDto {
  pub barcode: String,
  pub product_code: Option<String>,
}

// -------------------- SALES --------------------

#[derive(serde::Deserialize)]
struct CreateSaleItemPayload {
  barcode: String,
  qty: i64,
  list_price: f64,
  discount_amount: f64,
  unit_price: f64,
  sold_from: String,
}

#[derive(serde::Deserialize)]
struct CreateSalePayload {
  sold_from_default: String,
  items: Vec<CreateSaleItemPayload>,
  payment_method: Option<String>,
}

#[derive(serde::Serialize)]
struct CreateSaleResult {
  sale_group_id: String,
  total: f64,
  lines: i64,
}

#[tauri::command]
fn create_sale(payload: CreateSalePayload) -> Result<CreateSaleResult, String> {
  db::create_sale(db::CreateSalePayload {
    sold_from_default: payload.sold_from_default.trim().to_string(),
    payment_method: normalize_payment_method(payload.payment_method),
    items: payload
      .items
      .into_iter()
      .map(|i| db::CreateSaleItemPayload {
        barcode: i.barcode.trim().to_string(),
        qty: i.qty,
        list_price: i.list_price,
        discount_amount: i.discount_amount,
        unit_price: i.unit_price,
        sold_from: i.sold_from.trim().to_string(),
      })
      .collect(),
  })
  .map(|r| CreateSaleResult {
    sale_group_id: r.sale_group_id,
    total: r.total,
    lines: r.lines,
  })
}

#[derive(serde::Serialize)]
struct UndoLastSaleResult {
  sale_group_id: String,
  restored_lines: i64,
}

#[tauri::command]
fn undo_last_sale() -> Result<UndoLastSaleResult, String> {
  db::undo_last_sale().map(|r| UndoLastSaleResult {
    sale_group_id: r.sale_group_id,
    restored_lines: r.restored_lines,
  })
}

// -------------------- TRANSFER (Mağaza <-> Depo) --------------------

#[derive(serde::Deserialize)]
struct CreateTransferItemPayload {
  barcode: String,
  qty: i64,
  from_loc: String,
  to_loc: String,
}

#[derive(serde::Deserialize)]
struct CreateTransferPayload {
  items: Vec<CreateTransferItemPayload>,
  note: Option<String>,
}

#[derive(serde::Serialize)]
struct CreateTransferResult {
  transfer_group_id: String,
  lines: i64,
}

#[derive(serde::Serialize)]
struct UndoLastTransferResult {
  transfer_group_id: String,
  restored_lines: i64,
}

#[tauri::command]
fn create_transfer(payload: CreateTransferPayload) -> Result<CreateTransferResult, String> {
  db::create_transfer(db::CreateTransferPayload {
    items: payload
      .items
      .into_iter()
      .map(|it| db::CreateTransferItemPayload {
        barcode: it.barcode.trim().to_string(),
        qty: it.qty,
        from_loc: it.from_loc.trim().to_string(),
        to_loc: it.to_loc.trim().to_string(),
      })
      .collect(),
    note: norm_opt(payload.note),
  })
  .map(|r| CreateTransferResult {
    transfer_group_id: r.transfer_group_id,
    lines: r.lines,
  })
}

#[tauri::command]
fn undo_last_transfer() -> Result<UndoLastTransferResult, String> {
  db::undo_last_transfer().map(|r| UndoLastTransferResult {
    transfer_group_id: r.transfer_group_id,
    restored_lines: r.restored_lines,
  })
}

// -------------------- RETURN / EXCHANGE --------------------

#[derive(serde::Deserialize)]
struct ListSalesByBarcodePayload {
  barcode: String,
  days: i64,
}

#[derive(serde::Serialize)]
struct SaleLineDto {
  sold_at: String,
  qty: i64,
  unit_price: f64,
  total: f64,
  sold_from: String,
  refunded_qty: i64,
}

#[tauri::command]
fn list_sales_by_barcode(payload: ListSalesByBarcodePayload) -> Result<Vec<SaleLineDto>, String> {
  let bc = payload.barcode.trim().to_string();
  if bc.is_empty() {
    return Err("barcode zorunlu (boş olamaz).".into());
  }

  db::list_sales_by_barcode(&bc, payload.days).map(|rows| {
    rows
      .into_iter()
      .map(|r| SaleLineDto {
        sold_at: r.sold_at,
        qty: r.qty,
        unit_price: r.unit_price,
        total: r.total,
        sold_from: r.sold_from,
        refunded_qty: r.refunded_qty,
      })
      .collect()
  })
}

#[derive(serde::Deserialize)]
struct CreateReturnPayload {
  barcode: String,
  qty: i64,
  return_to: String,
  sold_at: Option<String>,
  sold_from: Option<String>,
  unit_price: f64,
}

#[derive(serde::Serialize)]
struct CreateReturnResult {
  return_group_id: String,
  lines: i64,
  returned_total: f64,
}

#[tauri::command]
fn create_return(payload: CreateReturnPayload) -> Result<CreateReturnResult, String> {
  db::create_return(db::CreateReturnPayload {
    barcode: payload.barcode.trim().to_string(),
    qty: payload.qty,
    return_to: payload.return_to.trim().to_string(),
    sold_at: norm_opt(payload.sold_at),
    sold_from: norm_opt(payload.sold_from),
    unit_price: payload.unit_price,
  })
  .map(|r| CreateReturnResult {
    return_group_id: r.return_group_id,
    lines: r.lines,
    returned_total: r.returned_total,
  })
}

#[derive(serde::Deserialize)]
struct CreateExchangeReturnedPayload {
  barcode: String,
  qty: i64,
  return_to: String,
  sold_at: Option<String>,
  sold_from: Option<String>,
  unit_price: f64,
}

#[derive(serde::Deserialize)]
struct CreateExchangeGivenItemPayload {
  barcode: String,
  qty: i64,
  sold_from: String,
  unit_price: f64,
}

#[derive(serde::Deserialize)]
struct CreateExchangeSummaryPayload {
  diff_payment_method: Option<String>,
}

#[derive(serde::Deserialize)]
struct CreateExchangePayload {
  returned: CreateExchangeReturnedPayload,
  given: Vec<CreateExchangeGivenItemPayload>,
  summary: CreateExchangeSummaryPayload,
}

#[derive(serde::Serialize)]
struct CreateExchangeResult {
  exchange_group_id: String,
  lines: i64,
  returned_total: f64,
  given_total: f64,
  diff: f64,
}

#[tauri::command]
fn create_exchange(payload: CreateExchangePayload) -> Result<CreateExchangeResult, String> {
  db::create_exchange(db::CreateExchangePayload {
    returned: db::CreateExchangeReturnedPayload {
      barcode: payload.returned.barcode.trim().to_string(),
      qty: payload.returned.qty,
      return_to: payload.returned.return_to.trim().to_string(),
      sold_at: norm_opt(payload.returned.sold_at),
      sold_from: norm_opt(payload.returned.sold_from),
      unit_price: payload.returned.unit_price,
    },
    given: payload
      .given
      .into_iter()
      .map(|x| db::CreateExchangeGivenItemPayload {
        barcode: x.barcode.trim().to_string(),
        qty: x.qty,
        sold_from: x.sold_from.trim().to_string(),
        unit_price: x.unit_price,
      })
      .collect(),
    summary: db::CreateExchangeSummaryPayload {
      diff_payment_method: norm_opt(payload.summary.diff_payment_method),
    },
  })
  .map(|r| CreateExchangeResult {
    exchange_group_id: r.exchange_group_id,
    lines: r.lines,
    returned_total: r.returned_total,
    given_total: r.given_total,
    diff: r.diff,
  })
}

// -------------------- EXPENSES --------------------

#[derive(serde::Deserialize)]
struct AddExpensePayload {
  spent_at: String,
  period: Option<String>,
  category: Option<String>,
  amount: f64,
  note: Option<String>,
}

#[tauri::command]
fn list_expenses() -> Result<Vec<db::Expense>, String> {
  db::list_expenses()
}

#[tauri::command]
fn add_expense(payload: AddExpensePayload) -> Result<i64, String> {
  db::add_expense(
    payload.spent_at.trim().to_string(),
    norm_opt(payload.period),
    norm_opt(payload.category),
    payload.amount,
    norm_opt(payload.note),
  )
}

#[tauri::command]
fn delete_expense(id: i64) -> Result<i64, String> {
  db::delete_expense(id)
}

// -------------------- SOLD PRODUCTS / GROUPS --------------------

#[tauri::command]
fn list_sale_groups(days: i64, q: Option<String>) -> Result<Vec<db::SaleGroupRow>, String> {
  db::list_sale_groups(days, norm_opt_q(q))
}

#[tauri::command]
fn list_sales_by_group(sale_group_id: String) -> Result<Vec<db::SaleLineRow>, String> {
  db::list_sales_by_group(&sale_group_id)
}

// -------------------- DASHBOARD --------------------

#[tauri::command]
fn get_dashboard_summary(days: i64, months: i64) -> Result<db::DashboardSummary, String> {
  db::get_dashboard_summary(days, months)
}

#[tauri::command]
fn get_cash_report(days: i64) -> Result<Vec<db::CashReportRow>, String> {
  db::get_cash_report(days)
}

// -------------------- DICTIONARIES (Categories / Colors / Sizes) --------------------

#[derive(serde::Serialize)]
struct DictItemDto {
  id: i64,
  name: String,
  is_active: i64,
  created_at: Option<String>,
  sort_order: Option<i64>, // sizes için
}

#[tauri::command]
fn list_categories(include_inactive: Option<bool>) -> Result<Vec<DictItemDto>, String> {
  let inc = include_inactive.unwrap_or(false);
  db::list_categories_full(inc).map(|rows| {
    rows
      .into_iter()
      .map(|r| DictItemDto {
        id: r.id,
        name: r.name,
        is_active: r.is_active,
        created_at: r.created_at,
        sort_order: None,
      })
      .collect()
  })
}

#[tauri::command]
fn create_category(name: String) -> Result<i64, String> {
  let n = norm_req_len("name", name, 100)?;
  db::create_category(n)
}

#[tauri::command]
fn update_category(id: i64, name: Option<String>, is_active: Option<i64>) -> Result<i64, String> {
  let n = match name {
    Some(v) => {
      let t = v.trim().to_string();
      if t.is_empty() { return Err("name boş olamaz.".into()); }
      Some(t)
    }
    None => None,
  };
  db::update_category(id, n, is_active)
}

#[tauri::command]
fn delete_category(id: i64) -> Result<i64, String> {
  db::delete_category(id)
}

#[tauri::command]
fn list_colors(include_inactive: Option<bool>) -> Result<Vec<DictItemDto>, String> {
  let inc = include_inactive.unwrap_or(false);
  db::list_colors_full(inc).map(|rows| {
    rows
      .into_iter()
      .map(|r| DictItemDto {
        id: r.id,
        name: r.name,
        is_active: r.is_active,
        created_at: r.created_at,
        sort_order: None,
      })
      .collect()
  })
}
#[tauri::command]
fn list_categories_full(include_inactive: bool) -> Result<Vec<db::CategoryRow>, String> {
  db::list_categories_full(include_inactive)
}

#[tauri::command]
fn list_colors_full(include_inactive: bool) -> Result<Vec<db::ColorRow>, String> {
  db::list_colors_full(include_inactive)
}

#[tauri::command]
fn list_sizes_full(include_inactive: bool) -> Result<Vec<db::SizeRow>, String> {
  db::list_sizes_full(include_inactive)
}

#[tauri::command]
fn create_color(name: String) -> Result<i64, String> {
  let n = norm_req_len("name", name, 100)?;
  db::create_color(n)
}

#[tauri::command]
fn update_color(id: i64, name: Option<String>, is_active: Option<i64>) -> Result<i64, String> {
  let n = match name {
    Some(v) => {
      let t = v.trim().to_string();
      if t.is_empty() { return Err("name boş olamaz.".into()); }
      Some(t)
    }
    None => None,
  };
  db::update_color(id, n, is_active)
}

#[tauri::command]
fn delete_color(id: i64) -> Result<i64, String> {
  db::delete_color(id)
}

#[tauri::command]
fn list_sizes(include_inactive: Option<bool>) -> Result<Vec<DictItemDto>, String> {
  let inc = include_inactive.unwrap_or(false);
  db::list_sizes_full(inc).map(|rows| {
    rows
      .into_iter()
      .map(|r| DictItemDto {
        id: r.id,
        name: r.name,
        is_active: r.is_active,
        created_at: r.created_at,
        sort_order: Some(r.sort_order),
      })
      .collect()
  })
}

#[tauri::command]
fn create_size(name: String, sort_order: Option<i64>) -> Result<i64, String> {
  let n = norm_req_len("name", name, 100)?;
  db::create_size(n, sort_order)
}

#[tauri::command]
fn update_size(
  id: i64,
  name: Option<String>,
  sort_order: Option<i64>,
  is_active: Option<i64>,
) -> Result<i64, String> {
  let n = match name {
    Some(v) => {
      let t = v.trim().to_string();
      if t.is_empty() { return Err("name boş olamaz.".into()); }
      Some(t)
    }
    None => None,
  };
  db::update_size(id, n, sort_order, is_active)
}

#[tauri::command]
fn delete_size(id: i64) -> Result<i64, String> {
  db::delete_size(id)
}

// -------------------- BACKUP --------------------

#[tauri::command]
fn backup_now(app: tauri::AppHandle) -> Result<String, String> {
  backup::backup_sqlite_db(&app)
}

#[tauri::command]
fn get_backup_dir(app: tauri::AppHandle) -> Result<String, String> {
  let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let backups_dir = app_dir.join("backups");
  std::fs::create_dir_all(&backups_dir).map_err(|e| e.to_string())?;
  Ok(backups_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn open_backup_folder(app: tauri::AppHandle) -> Result<(), String> {
  let app_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
  let backup_dir = app_dir.join("backups");
  std::fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;

  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg(&backup_dir)
      .spawn()
      .map_err(|e| e.to_string())?;
  }

  #[cfg(target_os = "windows")]
  {
    std::process::Command::new("explorer")
      .arg(&backup_dir)
      .spawn()
      .map_err(|e| e.to_string())?;
  }

  #[cfg(all(unix, not(target_os = "macos")))]
  {
    std::process::Command::new("xdg-open")
      .arg(&backup_dir)
      .spawn()
      .map_err(|e| e.to_string())?;
  }

  Ok(())
}

#[tauri::command]
fn restore_from_backup(
  app: tauri::AppHandle,
  payload: backup::RestoreFromBackupPayload,
) -> Result<backup::RestoreFromBackupResult, String> {
  backup::restore_from_backup(&app, payload)
}

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      // DB init / migrations
      db::init(&app.handle()).map_err(|e| {
        let err: Box<dyn std::error::Error> =
          Box::new(std::io::Error::new(std::io::ErrorKind::Other, e));
        tauri::Error::Setup(err.into())
      })?;
      Ok(())
    })
    // pencere kapanırken otomatik yedek
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        let app = window.app_handle().clone(); // 👈 kritik: clone

        std::thread::spawn(move || {
          let _ = backup::backup_sqlite_db(&app);
        });
      }
    })
    .invoke_handler(tauri::generate_handler![
      // products
      ping_db,
      list_products,
      add_product,
      update_product,
      delete_product,
      find_product,

      // sales
      create_sale,
      undo_last_sale,

      // returns / exchange
      list_sales_by_barcode,
      create_return,
      create_exchange,

      // transfer
      create_transfer,
      undo_last_transfer,

      // expenses
      list_expenses,
      add_expense,
      delete_expense,

      // dashboard
      get_dashboard_summary,
      get_cash_report,

      // sold products/groups
      list_sale_groups,
      list_sales_by_group,

      // dictionaries
      list_categories,
      create_category,
      update_category,
      delete_category,
      list_colors,
      create_color,
      update_color,
      delete_color,
      list_sizes,
      create_size,
      update_size,
      delete_size,
      list_categories_full,
      list_colors_full,
      list_sizes_full,

      // backup
      backup_now,
      get_backup_dir,
      open_backup_folder,
      restore_from_backup,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}