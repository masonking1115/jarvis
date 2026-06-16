import { Sidebar } from "@/components/Sidebar";
import { HeaderBar } from "@/components/HeaderBar";
import { FlyoverProvider } from "@/components/flyover/FlyoverProvider";
import { VoiceProvider } from "@/components/voice/VoiceProvider";
import { VoiceIndicator } from "@/components/voice/VoiceIndicator";
import { AmbientOrb } from "@/components/voice/AmbientOrb";

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <VoiceProvider>
      <FlyoverProvider>
        <div className="flex min-h-screen grid-bg">
          <Sidebar />
          <div className="flex-1 flex flex-col min-w-0">
            <HeaderBar />
            <main className="flex-1 p-5 overflow-x-hidden">{children}</main>
          </div>
        </div>
      </FlyoverProvider>
      {/* Persistent JARVIS sphere on every tab — voice-reactive, glides to center while talking */}
      <AmbientOrb />
      <VoiceIndicator />
    </VoiceProvider>
  );
}
