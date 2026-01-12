# BOUTIQUE POS 🧾  
**Offline-first point of sale & inventory system for boutiques**

BOUTIQUE POS is a desktop POS application designed specifically for  
boutiques and small retail stores.

It is built with an **offline-first architecture**, ensuring that sales  
can continue even when the internet is unstable or unavailable.

The system is developed using **Tauri + React + Rust + SQLite**.

---

## 🚀 Features

### 🛒 Sales
- Fast barcode-based sales
- Cash / Card payment support
- Undo last sale
- Multi-item receipts

### 🔄 Returns & Exchanges
- Refund processing
- Product exchange support
- In exchanges, **only the price difference (diff)** affects the cash register
- Payment method selection for exchange difference (Cash / Card)
- Original sale lines are automatically **voided** to prevent stock duplication

### 📦 Inventory Management
- Store & warehouse stock separation
- Stock validation during sales
- Stock validation during exchanges (prevents negative stock)
- Store ↔ warehouse transfers

### 📊 Dashboard & Reports
- Daily and monthly sales summaries
- Gross profit & net profit calculation
- Expense-aware net profit
- Cash register report (Cash / Card split)
- Daily cash flow breakdown

### 🏷️ Barcode Printing
- Generate barcodes for products added today
- Generate barcodes for selected products
- Print labels based on available stock quantity
- Printer-friendly label layout

### 💾 Backup & Restore
- Automatic SQLite backup on app close
- Manual backup option
- Open backup folder from settings
- Safe restore with automatic safety backup

---

## 🧠 Technical Architecture

### Frontend
- **React + TypeScript**
- Vite
- Modern component-based UI
- Offline-first design

### Backend
- **Rust (Tauri)**
- SQLite via `rusqlite`
- WAL mode enabled for reliability
- Transaction-safe database operations

### Database
- SQLite
- Foreign key protected schema
- Separate tables for sales, returns, exchanges
- Stock consistency guaranteed

---

## 🖥️ Platform Support
- ✅ macOS (development)
- ✅ Windows 10 / 11 (.exe production build)

---

## 📦 Development Setup

```bash
pnpm install
pnpm dev
pnpm tauri dev