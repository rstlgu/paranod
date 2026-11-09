import { isInitialSetupRequired } from '@/lib/setup';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function Page() {
  redirect((await isInitialSetupRequired()) ? '/setup' : '/sign-in');
}
