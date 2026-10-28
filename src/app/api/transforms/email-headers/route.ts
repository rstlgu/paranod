import { createLocalTransformRoute } from '@/features/plugins/local-transform-route';
import { emailHeadersPluginExecutor } from '@/features/plugins/builtin/email-headers-plugin';

export const runtime = 'nodejs';
export const POST = createLocalTransformRoute(
  'email-headers',
  emailHeadersPluginExecutor
);
