import { Header } from './Header';
import { HeroLanding } from './HeroLanding';

export function HomePage() {
  return (
    <main className="animate-page-rise min-h-screen overflow-x-hidden bg-[#04163f] text-white">
      <Header />
      <HeroLanding />
    </main>
  );
}
