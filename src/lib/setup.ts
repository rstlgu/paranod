import { APIError } from 'better-auth/api';
import { db } from '@/lib/db';

export async function isInitialSetupRequired(): Promise<boolean> {
  return (await db.user.count()) === 0;
}

/** Applies at the database write boundary, after any HTTP signup precheck. */
export async function prepareUserCreation<T extends Record<string, unknown>>(
  user: T,
  context: { path?: string } | null
) {
  // Better Auth verifies the administrator before this endpoint reaches its
  // database hook. HTTP access to the admin endpoints is disabled separately.
  if (context?.path === '/admin/create-user') return { data: user };

  if (context?.path !== '/sign-up/email' || !(await isInitialSetupRequired())) {
    throw new APIError('FORBIDDEN', {
      message: 'Users must be created by an administrator',
      code: 'PUBLIC_SIGNUP_CLOSED'
    });
  }

  // Every public signup claims the same unique key. Concurrent requests that
  // both observe an empty database therefore cannot create a second account.
  return {
    data: { ...user, role: 'admin', bootstrapKey: 'oss-initial-admin' }
  };
}
