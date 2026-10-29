import type { Metadata } from "next";
export const metadata: Metadata = { title: "ניהול אתר דרך התקומה", robots: { index: false, follow: false } };
export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) { return <html lang="he" dir="rtl"><body style={{margin:0}}>{children}</body></html>; }
