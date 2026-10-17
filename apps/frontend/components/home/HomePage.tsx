import { Header } from './Header';
import { HeroLanding } from './HeroLanding';
import { AiShuttleChat } from './AiShuttleChat';
import { Footer } from './Footer';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';

export async function HomePage() {
  return (
    <main className="animate-page-rise min-h-screen overflow-hidden bg-[#04163f] text-white">
      <Header />
      <HeroLanding />
      <AiShuttleChat />
      <Footer />
      <MobileBottomNav activeHref="/" />
    </main>
  );
}
