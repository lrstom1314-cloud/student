"use client";

import { useState } from "react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }

  return (
    <button type="button" className="secondary" onClick={logout} disabled={pending}>
      {pending ? "退出中…" : "退出登录"}
    </button>
  );
}
