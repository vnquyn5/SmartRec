import React from "react";
import { Link } from "react-router-dom";

export default function BrandLink({ className = "" }) {
  return (
    <Link
      to="/"
      className={`sidebar-brand sidebar-brand-link ${className}`.trim()}
      aria-label="SmartRec — về Dashboard"
      title="Về Dashboard"
    >
      <span className="auth-logo-mark" aria-hidden="true">
        <span />
      </span>
      <strong>
        Smart<span>Rec</span>
      </strong>
    </Link>
  );
}
