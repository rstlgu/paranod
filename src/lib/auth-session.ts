import { headers } from 'next/headers';
import { authService } from '@/lib/auth';

export async function getSession() {
  return authService.api.getSession({ headers: await headers() });
}

export async function auth(): Promise<{ userId: string | null }> {
  const session = await getSession();
  return { userId: session?.user.id ?? null };
}

export async function currentUser() {
  const session = await getSession();
  if (!session) return null;

  return {
    id: session.user.id,
    fullName: session.user.name,
    firstName: session.user.name.split(/\s+/)[0] || null,
    imageUrl: session.user.image || '',
    emailAddresses: [{ emailAddress: session.user.email }],
    primaryEmailAddress: { emailAddress: session.user.email },
    role: session.user.role
  };
}
