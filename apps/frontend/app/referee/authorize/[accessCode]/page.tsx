import AuthorizeTournament from '@/components/referee/AuthorizeTournament';

export default async function AuthorizePage({ params }: { params: Promise<{ accessCode: string }> }) {
  const { accessCode } = await params;
  return <AuthorizeTournament key={accessCode} accessCode={accessCode} />;
}
