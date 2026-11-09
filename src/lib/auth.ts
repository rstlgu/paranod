import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { nextCookies } from 'better-auth/next-js';
import { admin } from 'better-auth/plugins';
import { db } from '@/lib/db';
import { prepareUserCreation } from '@/lib/setup';

const BUILD_ONLY_SECRET =
  'paranod-build-only-secret-replaced-by-runtime-configuration';

function getTrustedOrigins(): string[] {
  const configured = [
    process.env.BETTER_AUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL
  ].filter((value): value is string => Boolean(value));

  if (process.env.NODE_ENV !== 'production') {
    configured.push('http://localhost:3000', 'http://127.0.0.1:3000');
  }

  return Array.from(new Set(configured));
}

async function ensureInitialWorkspace(user: {
  id: string;
  name: string;
  email: string;
  role?: string | null;
}) {
  const workspace = await db.workspace.upsert({
    where: { slug: 'your-workspace' },
    update: {},
    create: {
      name: 'Your Workspace',
      slug: 'your-workspace',
      description: 'Default self-hosted workspace'
    }
  });

  await db.workspaceMember.upsert({
    where: {
      userId_workspaceId: { userId: user.id, workspaceId: workspace.id }
    },
    update: {},
    create: {
      userId: user.id,
      workspaceId: workspace.id,
      role: user.role === 'admin' ? 'admin' : 'user'
    }
  });
  await db.userPreference.upsert({
    where: { userId: user.id },
    update: { activeWorkspaceId: workspace.id },
    create: { userId: user.id, activeWorkspaceId: workspace.id }
  });
}

export const authService = betterAuth({
  appName: 'PARANOD',
  secret:
    process.env.BETTER_AUTH_SECRET ||
    (process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NODE_ENV !== 'production'
      ? BUILD_ONLY_SECRET
      : (() => {
          throw new Error('BETTER_AUTH_SECRET is required');
        })()),
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
  trustedOrigins: getTrustedOrigins(),
  database: prismaAdapter(db, { provider: 'postgresql' }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: true
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'user',
        input: false
      },
      bootstrapKey: {
        type: 'string',
        required: false,
        input: false
      }
    }
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    freshAge: 60 * 10
  },
  databaseHooks: {
    user: {
      create: {
        before: prepareUserCreation,
        after: async (user) => {
          await ensureInitialWorkspace(user);
        }
      }
    }
  },
  plugins: [
    admin({ defaultRole: 'user', adminRoles: ['admin'] }),
    nextCookies()
  ]
});

export type AuthSession = typeof authService.$Infer.Session;
