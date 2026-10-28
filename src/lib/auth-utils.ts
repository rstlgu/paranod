/**
 * Auth Utility Functions
 * Helper functions for authentication and workspace management
 */

import { auth } from '@/lib/auth-session';
import { db } from '@/lib/db';

export interface ActiveWorkspaceAccess {
  userId: string;
  workspaceId: string;
  role: string;
}

/**
 * Resolve the authenticated user's active workspace and verify membership.
 * A stale preference must never grant access to another tenant.
 */
export async function getActiveWorkspaceAccess(): Promise<ActiveWorkspaceAccess | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const preferences = await db.userPreference.findUnique({
    where: { userId },
    select: { activeWorkspaceId: true }
  });
  const workspaceId = preferences?.activeWorkspaceId;
  if (!workspaceId) return null;

  const membership = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId
      }
    },
    select: { role: true }
  });
  if (!membership) return null;

  return {
    userId,
    workspaceId,
    role: membership.role
  };
}

/**
 * Get the active workspace ID for the current user
 * Returns null if user is not authenticated or has no active workspace
 */
export async function getActiveWorkspaceId(): Promise<string | null> {
  const access = await getActiveWorkspaceAccess();
  return access?.workspaceId ?? null;
}

/**
 * Get both userId and active workspaceId
 * Throws if user is not authenticated
 */
export async function getAuthContext(): Promise<{
  userId: string;
  workspaceId: string | null;
}> {
  const access = await getActiveWorkspaceAccess();
  if (!access) {
    throw new Error('Unauthorized');
  }

  return {
    userId: access.userId,
    workspaceId: access.workspaceId
  };
}

/**
 * Check if a user is admin of an workspace
 */
export async function isWorkspaceAdmin(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const member = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId: workspaceId
      }
    },
    select: { role: true }
  });

  return member?.role === 'admin';
}
