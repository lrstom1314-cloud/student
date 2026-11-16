import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "学生系统",
  description: "单机构教务系统",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
