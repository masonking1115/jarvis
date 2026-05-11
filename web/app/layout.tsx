import "./globals.css";
import type { Metadata } from "next";
import { Orbitron, Rajdhani, Inter, JetBrains_Mono } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { HeaderBar } from "@/components/HeaderBar";

const display = Orbitron({ subsets: ["latin"], weight: ["500","600","700","800"], variable: "--font-display" });
const ui      = Rajdhani({ subsets: ["latin"], weight: ["400","500","600","700"], variable: "--font-ui" });
const body    = Inter({   subsets: ["latin"], weight: ["400","500","600","700"], variable: "--font-body" });
const mono    = JetBrains_Mono({ subsets: ["latin"], weight: ["400","500","700"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "JARVIS Console",
  description: "Central Life Optimization System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <div className="flex min-h-screen grid-bg">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <HeaderBar />
            <main className="flex-1 p-5 overflow-x-hidden">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
