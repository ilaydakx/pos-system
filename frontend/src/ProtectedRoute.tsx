import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { isAuthed } from "./auth";

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const loc = useLocation();

  if (isAuthed()) return <>{children}</>;

  return <Navigate to="/unlock" replace state={{ from: loc.pathname }} />;
}