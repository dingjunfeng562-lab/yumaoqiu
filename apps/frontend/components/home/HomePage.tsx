import { Header } from './Header';
import { HeroLanding } from './HeroLanding';
import { MobileBottomNav } from '@/components/mobile/MobileBottomNav';

export async function HomePage() {
  return (
    <main className="animate-page-rise min-h-screen overflow-hidden bg-[#04163f] text-white">
      <Header />
      <HeroLanding />
      <MobileBottomNav activeHref="/" />
    </main>
  );
}
