"use client";

import { useState, type ReactNode } from "react";
import { Menu, ChevronDown } from "lucide-react";

export default function AdminNavigation({ children, activeLabel }: { children: ReactNode; activeLabel: string }) {
  const [expanded, setExpanded] = useState(false);
  return <>
    <button type="button" className="admin-navigation-toggle" aria-controls="admin-navigation" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <Menu size={19} aria-hidden="true" />
      <span>ניווט במערכת <strong>{activeLabel}</strong></span>
      <ChevronDown size={17} aria-hidden="true" />
    </button>
    <nav id="admin-navigation" className="admin-navigation" aria-label="ניהול האתר" data-expanded={expanded}>{children}</nav>
  </>;
}
