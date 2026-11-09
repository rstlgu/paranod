import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth-session';
import { isInitialSetupRequired } from '@/lib/setup';
import InitialSetupView from '@/features/auth/components/initial-setup-view';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Set up PARANOD',
  description: 'Create the administrator for this PARANOD installation.'
};

export default async function SetupPage() {
  const setupRequired = await isInitialSetupRequired();
  if (!setupRequired) {
    const { userId } = await auth();
    redirect(userId ? '/' : '/sign-in');
  }

  return <InitialSetupView />;
}
