import SignInViewPage from '@/features/auth/components/sign-in-view';
import { auth } from '@/lib/auth-session';
import { isInitialSetupRequired } from '@/lib/setup';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: 'Authentication | Sign In',
  description: 'Sign In page for authentication.'
};

export default async function Page() {
  if (await isInitialSetupRequired()) redirect('/setup');

  const { userId } = await auth();

  if (userId) redirect('/');

  return <SignInViewPage />;
}
