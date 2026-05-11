import "./globals.css";
import type { Metadata } from "next";
import { Sidebar } from "@/components/Sidebar";
import { HeaderBar } from "@/components/HeaderBar";

export const metadata: Metadata = {
  title: "JARVIS Console",
  description: "Central Life Optimization System",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen grid-bg">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <HeaderBar />
            <main className="flex-1 p-6 overflow-x-hidden">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
