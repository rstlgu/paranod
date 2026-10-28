'use client';

import { useMemo } from 'react';
import { createAuthClient } from 'better-auth/react';
import { inferAdditionalFields } from 'better-auth/client/plugins';
import type { authService } from '@/lib/auth';

export const authClient = createAuthClient({
  plugins: [inferAdditionalFields<typeof authService>()]
});

export function useAuth() {
  const session = authClient.useSession();

  return {
    isLoaded: !session.isPending,
    isSignedIn: Boolean(session.data),
    userId: session.data?.user.id ?? null
  };
}

export function useUser() {
  const session = authClient.useSession();
  const source = session.data?.user;
  const sourceId = source?.id;
  const sourceName = source?.name;
  const sourceEmail = source?.email;
  const sourceImage = source?.image;
  const sourceRole = source?.role;
  const user = useMemo(
    () =>
      sourceId && sourceName && sourceEmail
        ? {
            id: sourceId,
            fullName: sourceName,
            firstName: sourceName.split(/\s+/)[0] || null,
            imageUrl: sourceImage || '',
            emailAddresses: [{ emailAddress: sourceEmail }],
            primaryEmailAddress: { emailAddress: sourceEmail },
            role: sourceRole
          }
        : null,
    [sourceEmail, sourceId, sourceImage, sourceName, sourceRole]
  );

  return {
    user,
    isLoaded: !session.isPending,
    isSignedIn: Boolean(user)
  };
}

export function useAuthActions() {
  return {
    signOut: async ({ redirectUrl }: { redirectUrl?: string } = {}) => {
      await authClient.signOut();
      window.location.assign(redirectUrl || '/sign-in');
    }
  };
}
