import { createLocalTransformRoute } from '@/features/plugins/local-transform-route';
import { hashEvidencePluginExecutor } from '@/features/plugins/builtin/hash-evidence-plugin';

export const runtime = 'nodejs';
export const POST = createLocalTransformRoute(
  'hash-evidence',
  hashEvidencePluginExecutor
);
