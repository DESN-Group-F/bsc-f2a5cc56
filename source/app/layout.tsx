import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
    title: "Battery Inventory | DESN2000",
    description: "Teacher-operated battery loans, responsibility records and room-level traceability.",
    icons: {
        icon: "/favicon.svg",
        shortcut: "/favicon.svg",
    },
};
export default function RootLayout({ children, }: Readonly<{
    children: React.ReactNode;
}>) {
    return (<html lang="en">
      <body className="antialiased">{children}</body>
    </html>);
}
