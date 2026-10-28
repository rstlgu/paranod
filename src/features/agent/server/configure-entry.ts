import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  agentApiKeySchema,
  agentOpenRouterModelsSchema,
  agentProviderSchema,
  saveAgentCredential
} from './credential';

// Operator-only import. The credential travels on stdin, never in argv or logs.
async function main() {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    length += buffer.length;
    if (length > 4096) throw new Error('input_too_large');
    chunks.push(buffer);
  }
  const input = z
    .object({
      workspaceId: z.string().min(1).max(160),
      userId: z.string().min(1).max(160),
      provider: agentProviderSchema.default('openai'),
      apiKey: agentApiKeySchema,
      models: agentOpenRouterModelsSchema.optional()
    })
    .strict()
    .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (!process.env.SECRETS_ENCRYPTION_KEY) {
    process.env.SECRETS_ENCRYPTION_KEY = (
      await readFile(
        path.join(
          process.env.AUTH_STATE_DIR ?? '/var/lib/paranod',
          'secrets-encryption-key'
        ),
        'utf8'
      )
    ).replace(/[\r\n]/g, '');
  }
  if (!process.env.SECRETS_ENCRYPTION_KEY)
    throw new Error('encryption_required');
  try {
    const membership = await db.workspaceMember.findUnique({
      where: {
        userId_workspaceId: {
          userId: input.userId,
          workspaceId: input.workspaceId
        }
      },
      select: { role: true }
    });
    if (membership?.role !== 'admin')
      throw new Error('workspace_admin_required');
    await saveAgentCredential(input);
    process.stdout.write(
      `Graph agent ${input.provider} key saved with encryption.\n`
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  // Validation and database errors can embed their input, including the secret.
  process.stderr.write(
    'Graph agent key configuration failed. No credential was logged.\n'
  );
  process.exitCode = 1;
});
