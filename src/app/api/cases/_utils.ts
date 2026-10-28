import { db } from '@/lib/db';
import { getAuthContext } from '@/lib/auth-utils';

export interface CaseRequestContext {
  userId: string;
  workspaceId: string;
  role: string;
}

export async function requireActiveWorkspaceMember(): Promise<
  | { ok: true; ctx: CaseRequestContext }
  | { ok: false; status: number; error: string }
> {
  try {
    const { userId, workspaceId } = await getAuthContext();
    if (!workspaceId)
      return {
        ok: false,
        status: 400,
        error: 'Missing active workspace'
      };

    const membership = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId, workspaceId: workspaceId } },
      select: { role: true }
    });

    if (!membership) return { ok: false, status: 403, error: 'Forbidden' };

    return { ok: true, ctx: { userId, workspaceId, role: membership.role } };
  } catch {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
}

export async function requireCaseInWorkspace(args: {
  caseId: string;
  workspaceId: string;
}) {
  const found = await db.case.findFirst({
    where: { id: args.caseId, workspaceId: args.workspaceId },
    select: { id: true, workspaceId: true, status: true }
  });
  return found;
}

export function safeJsonParseArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((x) => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}
