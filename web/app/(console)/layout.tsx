import { Sidebar } from "@/components/Sidebar";
import { HeaderBar } from "@/components/HeaderBar";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen grid-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <HeaderBar />
        <main className="flex-1 p-5 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
