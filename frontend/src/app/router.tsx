import { createBrowserRouter } from "react-router-dom";
import App from "../App";
import { Dashboard } from "../pages/Dashboard";
import { Products } from "../pages/Products";
import { ProductNew } from "../pages/ProductNew";
import { Sales } from "../pages/Sales";
import { Expenses } from "../pages/Expenses";
import { Transfer } from "../pages/Transfer";
import { StockControl } from "../pages/StockControl";
import { ReturnExchange } from "../pages/ReturnExchange";
import { SoldProducts } from "../pages/SoldProduct";
import Unlock from "../pages/Unlock";
import ProtectedRoute from "../ProtectedRoute";
import Settings from "../pages/Settings";
import BarcodePrint from "../pages/BarcodePrint";

export const router = createBrowserRouter([
  { path: "/unlock", element: <Unlock /> },

  {
    path: "/",
    element: <App />,
    children: [
      //Açılış sayfası: Satış
      { index: true, element: <Sales /> },

      // Şifreli: Dashboard
      {
        path: "dashboard",
        element: (
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        ),
      },

      //Şifreli: Expenses
      {
        path: "expenses",
        element: (
          <ProtectedRoute>
            <Expenses />
          </ProtectedRoute>
        ),
      },

      { path: "products", element: <Products /> },
      { path: "products/new", element: <ProductNew /> },
      { path: "transfer", element: <Transfer /> },
      { path: "stockcontrol", element: <StockControl /> },
      { path: "returns", element: <ReturnExchange /> },
      { path: "sales", element: <Sales /> },
      { path: "soldproducts", element: <SoldProducts /> },
      { path: "settings", element: <Settings /> },
      { path: "barcode-print", element: <BarcodePrint /> },
    ],
  },
]);