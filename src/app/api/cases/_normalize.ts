export interface NormalizeResult {
  normalizedValue: string;
  warnings: string[];
}

function stripSchemaAndPath(input: string) {
  try {
    const url = new URL(input);
    return url.hostname || input;
  } catch {
    return input;
  }
}

function normalizeDomainLike(value: string): NormalizeResult {
  const raw = value.trim().toLowerCase();
  const host = stripSchemaAndPath(raw).trim().toLowerCase();
  const normalizedValue = host.replace(/\.$/, '');
  const warnings: string[] = [];
  if (!normalizedValue) warnings.push('empty');
  return { normalizedValue, warnings };
}

function normalizeEmail(value: string): NormalizeResult {
  const normalizedValue = value.trim().toLowerCase();
  const warnings: string[] = [];
  if (!normalizedValue.includes('@')) warnings.push('missing_at');
  return { normalizedValue, warnings };
}

function normalizeUrl(value: string): NormalizeResult {
  const warnings: string[] = [];
  try {
    const url = new URL(value.trim());
    url.hash = '';
    const normalizedValue = url.toString();
    return { normalizedValue, warnings };
  } catch {
    return { normalizedValue: value.trim(), warnings: ['invalid_url'] };
  }
}

function normalizeIp(value: string): NormalizeResult {
  const normalizedValue = value.trim();
  return { normalizedValue, warnings: normalizedValue ? [] : ['empty'] };
}

export function normalizeEntity(args: {
  type: string;
  value: string;
}): NormalizeResult {
  const type = args.type.trim().toLowerCase();
  const value = args.value ?? '';

  if (type === 'email') return normalizeEmail(value);
  if (type === 'domain' || type === 'subdomain' || type === 'hostname')
    return normalizeDomainLike(value);
  if (type === 'url') return normalizeUrl(value);
  if (type === 'ip') return normalizeIp(value);

  return { normalizedValue: value.trim(), warnings: value.trim() ? [] : ['empty'] };
}
