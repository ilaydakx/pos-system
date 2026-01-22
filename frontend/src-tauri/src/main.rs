#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod backup;

use tauri::Manager;
use tauri_plugin_dialog;

// -------------------- PRODUCTS --------------------

#[derive(serde::Deserialize)]
struct AddProductPayload {
  barcode: String,
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
  db::find_product_by_barcode(&barcode)
}

#[tauri::command]
fn delete_product(barcode: String) -> Result<i64, String> {
  println!("[delete_product] called with barcode={}", barcode);
  db::delete_product(&barcode)
}

#[tauri::command]
fn add_product(payload: AddProductPayload) -> Result<String, String> {
  let barcode_opt = match payload.barcode.trim() {
    "" => None,
    _ => Some(payload.barcode),
  };

  db::add_product(
    barcode_opt,
    payload.product_code,
    payload.category,
    payload.name,
    payload.color,
    payload.size,
    payload.buy_price,
    payload.sell_price,
    payload.stock,
    payload.magaza_baslangic,
    payload.depo_baslangic,
  )
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
    sold_from_default: payload.sold_from_default,
    payment_method: payload
      .payment_method
      .unwrap_or_else(|| "CARD".to_string()),
    items: payload
      .items
      .into_iter()
      .map(|i| db::CreateSaleItemPayload {
        barcode: i.barcode,
        qty: i.qty,
        list_price: i.list_price,
        discount_amount: i.discount_amount,
        unit_price: i.unit_price,
        sold_from: i.sold_from,
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
        barcode: it.barcode,
        qty: it.qty,
        from_loc: it.from_loc,
        to_loc: it.to_loc,
      })
      .collect(),
    note: payload.note,
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
  refunded_qty: Option<i64>,
}

#[tauri::command]
fn list_sales_by_barcode(payload: ListSalesByBarcodePayload) -> Result<Vec<SaleLineDto>, String> {
  db::list_sales_by_barcode(&payload.barcode, payload.days).map(|rows| {
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
    barcode: payload.barcode,
    qty: payload.qty,
    return_to: payload.return_to,
    sold_at: payload.sold_at,
    sold_from: payload.sold_from,
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
  returned_total: f64,
  given_total: f64,
  diff: f64,
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
      barcode: payload.returned.barcode,
      qty: payload.returned.qty,
      return_to: payload.returned.return_to,
      sold_at: payload.returned.sold_at,
      sold_from: payload.returned.sold_from,
      unit_price: payload.returned.unit_price,
    },
    given: payload
      .given
      .into_iter()
      .map(|x| db::CreateExchangeGivenItemPayload {
        barcode: x.barcode,
        qty: x.qty,
        sold_from: x.sold_from,
        unit_price: x.unit_price,
      })
      .collect(),
    summary: db::CreateExchangeSummaryPayload {
      returned_total: payload.summary.returned_total,
      given_total: payload.summary.given_total,
      diff: payload.summary.diff,
      diff_payment_method: payload.summary.diff_payment_method.clone(), 
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
    payload.spent_at,
    payload.period,
    payload.category,
    payload.amount,
    payload.note,
  )
}

#[tauri::command]
fn delete_expense(id: i64) -> Result<i64, String> {
  db::delete_expense(id)
}

// -------------------- SOLD PRODUCTS / GROUPS --------------------

#[tauri::command]
fn list_sale_groups(days: i64, q: Option<String>) -> Result<Vec<db::SaleGroupRow>, String> {
  db::list_sale_groups(days, q)
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
  let app_dir = app.path().app_data_dir().map_err(|e| e.to_string()).unwrap();
  std::fs::create_dir_all(&app_dir).ok();
  let log_path = app_dir.join("debug.log");

  let log = |msg: &str| {
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
      let _ = writeln!(f, "{}", msg);
    }
  };

  log("[BOOT] start");
  log(&format!("[BOOT] app_dir={}", app_dir.to_string_lossy()));

  match db::init(&app.handle()) {
    Ok(_) => log("[DB] init OK"),
    Err(e) => {
      log(&format!("[DB] init ERR: {}", e));
      return Err(tauri::Error::Setup(
        std::io::Error::new(std::io::ErrorKind::Other, e).into(),
      ));
    }
  }

  Ok(())
})
    /*
    .setup(|app| {
      // DB init / migrations
      db::init(&app.handle()).map_err(|e| {
        let err: Box<dyn std::error::Error> =
          Box::new(std::io::Error::new(std::io::ErrorKind::Other, e));
        tauri::Error::Setup(err.into())
      })?;
      Ok(())
    })*/
    // pencere kapanırken otomatik yedek
    .on_window_event(|window, event| {
      if let tauri::WindowEvent::CloseRequested { .. } = event {
        let app = window.app_handle();
        let _ = backup::backup_sqlite_db(&app);
      }
    })
    .invoke_handler(tauri::generate_handler![
      // products
      ping_db,
      list_products,
      add_product,
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

      // backup
      backup_now,
      get_backup_dir,
      open_backup_folder,
      restore_from_backup,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}