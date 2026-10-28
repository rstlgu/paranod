export const entityTypes = [
  'email',
  'domain',
  'ip',
  'person',
  'username',
  'phone',
  'organization',
  'hash',
  'credential',
  'user_id',
  'device_id',
  'mac_address',
  'asn',
  'cidr',
  'hostname',
  'subdomain',
  'ssl_certificate',
  'whois_record',
  'social',
  'instagram_user',
  'instagram_post',
  'telegram_user',
  'telegram_channel',
  'telegram_group',
  'telegram_bot',
  'facebook_user',
  'facebook_group',
  'twitter_user',
  'twitter_post',
  'linkedin_profile',
  'github_user',
  'github_repo',
  'gitlab_user',
  'youtube_channel',
  'youtube_video',
  'tiktok_user',
  'tiktok_video',
  'reddit_user',
  'reddit_post',
  'discord_user',
  'discord_server',
  'whatsapp_number',
  'signal_number',
  'slack_workspace',
  'slack_channel',
  'document',
  'pdf',
  'docx',
  'xlsx',
  'txt',
  'csv',
  'json',
  'note',
  'media_url',
  'location',
  'maps',
  'address',
  'url',
  'dns_record',
  'http_request',
  'http_response',
  'wallet',
  'wallet_eth',
  'wallet_btc',
  'wallet_ltc',
  'wallet_tron',
  'wallet_solana',
  'transaction',
  'exchange',
  'bank_account',
  'iban',
  'credit_card',
  'paypal_account',
  'stripe_customer',
  'ai_insight',
  'breach',
  'leak',
  'custom'
] as const;

export type EntityType = (typeof entityTypes)[number];

export const nodeTypes = [...entityTypes, 'group', 'text'] as const;
export type NodeType = (typeof nodeTypes)[number];

export type NodeKind = 'entity' | 'ui';

const entityTypeSet: ReadonlySet<string> = new Set(entityTypes);

/**
 * True se la stringa è un EntityType riconosciuto dalla piattaforma.
 */
export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && entityTypeSet.has(value);
}

/**
 * Normalizza un tipo entità proveniente da una sorgente esterna (addon).
 * I tipi sconosciuti diventano 'custom', preservando il valore originale
 * così che l'UI possa mostrarlo senza rompere il rendering del grafo.
 */
export function coerceEntityType(value: unknown): {
  type: EntityType;
  originalType?: string;
} {
  if (isEntityType(value)) return { type: value };
  return {
    type: 'custom',
    originalType: typeof value === 'string' ? value : undefined
  };
}
