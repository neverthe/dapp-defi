import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { ConnectButton } from "@/components/ConnectButton";
import { NavLinks } from "@/components/NavLinks";
import { ChainGuard } from "@/components/ChainGuard";
import { ThemeToggle } from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "DeFi Swap DApp",
  description: "去中心化交易所 — AMM 恒定乘积 (x × y = k) 模型",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen bg-[var(--background)] text-[var(--foreground)] antialiased font-sans">
        <Providers>
          <ChainGuard>
            <Header />
            <main className="max-w-4xl mx-auto px-4 py-8">{children}</main>
          </ChainGuard>
        </Providers>
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="bg-[var(--card)] border-b border-[var(--card-border)] sticky top-0 z-50">
      <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6 min-w-0">
          <a href="/" className="text-xl font-bold text-indigo-600 shrink-0">
            DeFi Swap
          </a>
          <nav className="hidden md:flex items-center gap-1 text-sm overflow-x-auto">
            <NavLinks />
          </nav>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ThemeToggle />
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}