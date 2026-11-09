import type { NodeType } from '@/features/osint/node-registry';

function abbreviateMiddle(args: { value: string; head: number; tail: number }) {
  const v = args.value.trim();
  if (!v) return v;
  const min = args.head + args.tail + 3;
  if (v.length <= min) return v;
  return `${v.slice(0, args.head)}...${v.slice(-args.tail)}`;
}

export function getNodeDisplayLabel(args: {
  type: NodeType | string;
  label: string;
  metadata?: Record<string, unknown>;
}) {
  const raw =
    (typeof args.metadata?.hash === 'string' && args.metadata.hash) ||
    (typeof args.metadata?.address === 'string' && args.metadata.address) ||
    (typeof args.metadata?.value === 'string' && args.metadata.value) ||
    args.label;

  if (!raw) return args.label;

  const t = String(args.type);

  if (t === 'transaction') {
    const v = raw.trim();
    const head = v.startsWith('0x') ? 10 : 8;
    return abbreviateMiddle({ value: v, head, tail: 8 });
  }

  if (t === 'wallet' || t.startsWith('wallet_')) {
    const v = raw.trim();
    const head = v.startsWith('0x') ? 10 : 8;
    return abbreviateMiddle({ value: v, head, tail: 6 });
  }

  return args.label;
}
