import KBar from '@/components/kbar';
import { DashboardShell } from '@/components/layout/dashboard-shell';
import { RequireWorkspace } from '@/components/require-workspace';
import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

interface DbUrlInfo {
  host: string;
  port: string;
  database: string;
  username: string;
  hasPassword: boolean;
}

function getDbUrlInfo(value: string | undefined): DbUrlInfo | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const database = url.pathname.replace(/^\//, '');
    return {
      host: url.hostname,
      port: url.port,
      database,
      username: url.username,
      hasPassword: Boolean(url.password)
    };
  } catch {
    return null;
  }
}

function isPrismaInitializationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (
    'name' in error &&
    (error as { name?: unknown }).name === 'PrismaClientInitializationError'
  );
}

async function countMembershipsOrZero(userId: string): Promise<number> {
  try {
    return await db.workspaceMember.count({ where: { userId } });
  } catch (error) {
    if (!isPrismaInitializationError(error)) throw error;

    const databaseUrl = getDbUrlInfo(process.env.DATABASE_URL);
    const directUrl = getDbUrlInfo(process.env.DIRECT_URL);

    console.error(
      '[db] Prisma initialization failed while checking workspace memberships',
      {
        message: error instanceof Error ? error.message : String(error),
        databaseUrl,
        directUrl
      }
    );

    return 0;
  }
}

export async function AppShellLayout(props: { children: React.ReactNode }) {
  const { userId } = await auth();
  if (!userId) redirect('/sign-in');

  const hasMemberships = await countMembershipsOrZero(userId);

  const cookieStore = await cookies();
  const defaultOpen = cookieStore.get('sidebar_state')?.value === 'true';

  return (
    <RequireWorkspace hasWorkspace={hasMemberships > 0}>
      <KBar>
        <DashboardShell defaultOpen={defaultOpen}>
          {props.children}
        </DashboardShell>
      </KBar>
    </RequireWorkspace>
  );
}
