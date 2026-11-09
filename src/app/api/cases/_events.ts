export interface ExtractedFactualEvent {
  type: string;
  occurredAt: Date;
  confidence: 'low' | 'medium' | 'confirmed';
  message?: string;
  data?: Record<string, unknown>;
}

function parseDateMaybe(value: unknown): Date | null {
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function getDeep(meta: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (!acc || typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, meta);
}

export function extractFactualEvents(args: {
  entityType: string;
  metadata: Record<string, unknown>;
}): ExtractedFactualEvent[] {
  const entityType = args.entityType.toLowerCase();
  const meta = args.metadata;

  const candidates: Array<{ type: string; paths: string[] }> = [];

  if (entityType === 'instagram_user') {
    candidates.push({
      type: 'registered_on',
      paths: ['registered_on', 'registeredOn', 'created_at', 'createdAt']
    });
  }

  if (entityType === 'domain') {
    candidates.push({
      type: 'domain_registered',
      paths: ['registered_on', 'registrationDate', 'whois.createdDate', 'whois.created_at']
    });
  }

  // fallback generic keys (useful across many entities)
  candidates.push({
    type: 'created_at',
    paths: ['created_at', 'createdAt']
  });

  const events: ExtractedFactualEvent[] = [];
  for (const c of candidates) {
    for (const p of c.paths) {
      const v = getDeep(meta, p);
      const dt = parseDateMaybe(v);
      if (!dt) continue;
      events.push({
        type: c.type,
        occurredAt: dt,
        confidence: 'medium',
        message: undefined,
        data: { field: p, raw: v }
      });
      break;
    }
  }

  // Dedup by type+timestamp
  const seen = new Set<string>();
  return events.filter((e) => {
    const k = `${e.type}:${e.occurredAt.toISOString()}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
