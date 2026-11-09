/**
 * OSINT Plugin Registry
 * Definisce tutti i plugin disponibili nella piattaforma
 */

import type {
  PluginDefinition,
  EntityType,
  TransformDefinition
} from './types';
import { emailHeadersPlugin, hashEvidencePlugin } from './evidence-definitions';

const socialTypePrefixes = [
  'instagram_',
  'telegram_',
  'facebook_',
  'twitter_',
  'linkedin_',
  'github_',
  'gitlab_',
  'youtube_',
  'tiktok_',
  'reddit_',
  'discord_',
  'whatsapp_',
  'signal_',
  'slack_'
] as const;

function isSocialEntityType(entityType: string): boolean {
  if (entityType === 'social') return true;
  return socialTypePrefixes.some((prefix) => entityType.startsWith(prefix));
}

// ============================================
// DNS Lookup Plugin
// ============================================

export const dnsPlugin: PluginDefinition = {
  id: 'dns-lookup',
  name: 'DNS Lookup',
  description:
    'Resolves DNS records for domains. Supports A, MX, TXT, NS records.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconServer',
  category: 'network',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['domain'],
  outputTypes: ['ip', 'domain', 'dns_record'],

  transforms: [
    {
      id: 'dns-resolve-a',
      name: 'Resolve A Records',
      description: 'Resolves IPv4 addresses for the domain',
      inputType: 'domain',
      outputTypes: ['ip']
    },
    {
      id: 'dns-resolve-mx',
      name: 'Get MX Records',
      description: 'Gets mail server records for the domain',
      inputType: 'domain',
      outputTypes: ['domain']
    },
    {
      id: 'dns-resolve-ns',
      name: 'Get Nameservers',
      description: 'Gets nameserver records for the domain',
      inputType: 'domain',
      outputTypes: ['domain']
    },
    {
      id: 'dns-resolve-txt',
      name: 'Get TXT Records',
      description: 'Gets TXT records (SPF, DKIM, etc.)',
      inputType: 'domain',
      outputTypes: ['dns_record']
    },
    {
      id: 'dns-resolve-extra',
      name: 'More DNS Records',
      description: 'Gets AAAA (IPv6), CNAME, SOA and CAA records in one go',
      inputType: 'domain',
      outputTypes: ['ip', 'domain', 'dns_record']
    }
  ],

  estimatedTime: 'instant',
  enabled: true
};

// ============================================
// Email Parser Plugin
// ============================================

export const emailPlugin: PluginDefinition = {
  id: 'email-parser',
  name: 'Email Parser',
  description: 'Analyzes and validates email addresses, extracts information.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconMail',
  category: 'identity',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['email'],
  outputTypes: ['domain', 'email', 'media_url', 'url', 'username'],

  transforms: [
    {
      id: 'email-extract-domain',
      name: 'Extract Domain',
      description: 'Extracts the domain from the email address',
      inputType: 'email',
      outputTypes: ['domain']
    },
    {
      id: 'email-validate',
      name: 'Validate Email',
      description:
        'Validates format, checks MX deliverability and lists mail servers',
      inputType: 'email',
      outputTypes: ['email', 'domain']
    },
    {
      id: 'email-gravatar',
      name: 'Gravatar Lookup',
      description:
        'Fetches the public Gravatar profile and avatar linked to the email.',
      inputType: 'email',
      outputTypes: ['media_url', 'url', 'username']
    }
  ],

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// IP Geolocation Plugin
// ============================================

export const ipPlugin: PluginDefinition = {
  id: 'ip-geolocation',
  name: 'IP & Network Intelligence',
  description:
    'Geolocates IPs and maps network infrastructure: ASN, CIDR ranges and organization lookups.',
  version: '1.1.0',
  author: 'PARANOD Team',
  icon: 'IconMapPin',
  category: 'network',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['ip', 'domain', 'asn', 'cidr', 'organization'],
  outputTypes: [
    'location',
    'organization',
    'maps',
    'hostname',
    'asn',
    'cidr',
    'ip',
    'domain'
  ],

  transforms: [
    {
      id: 'ip-geolocate',
      name: 'Geolocate IP',
      description: 'Gets the geographic location of the IP address',
      inputType: 'ip',
      outputTypes: ['location']
    },
    {
      id: 'ip-asn-lookup',
      name: 'ASN Lookup',
      description: 'Gets ISP and ASN information',
      inputType: 'ip',
      outputTypes: ['organization']
    },
    {
      id: 'ip-show-on-map',
      name: 'Show on Map',
      description: 'Creates an interactive map showing the IP location',
      inputType: 'ip',
      outputTypes: ['maps']
    },
    {
      id: 'ip-reverse-dns',
      name: 'Reverse DNS (PTR)',
      description: 'Resolves the PTR hostname(s) for the IP address',
      inputType: 'ip',
      outputTypes: ['hostname']
    },
    {
      id: 'ip-reverse-ip',
      name: 'Reverse IP (shared hosting)',
      description: 'Finds other domains hosted on the same IP address',
      inputType: 'ip',
      outputTypes: ['domain']
    },
    {
      id: 'domain-to-asn',
      name: 'Domain to ASN',
      description: 'Resolves the domain and finds its ASN',
      inputType: 'domain',
      outputTypes: ['asn', 'organization']
    },
    {
      id: 'asn-to-cidrs',
      name: 'ASN to CIDRs',
      description: 'Lists the IP prefixes (CIDRs) announced by an ASN',
      inputType: 'asn',
      outputTypes: ['cidr']
    },
    {
      id: 'cidr-to-ips',
      name: 'CIDR to IPs',
      description: 'Expands an IPv4 CIDR block into individual IP addresses',
      inputType: 'cidr',
      outputTypes: ['ip']
    },
    {
      id: 'org-to-asn',
      name: 'Organization to ASN',
      description: 'Finds ASNs registered to an organization name',
      inputType: 'organization',
      outputTypes: ['asn']
    }
  ],

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// URL Parser Plugin
// ============================================

export const urlPlugin: PluginDefinition = {
  id: 'url-parser',
  name: 'Domain',
  description:
    'Domain, URL & website enrichment: domain, root domain, website, links, trackers, text, crawl.',
  version: '1.2.0',
  author: 'PARANOD Team',
  icon: 'IconLink',
  category: 'network',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['url', 'domain'],
  outputTypes: ['domain', 'ip', 'url', 'note', 'organization'],

  transforms: [
    {
      id: 'url-extract-domain',
      name: 'Extract Domain',
      description: 'Extracts the domain from the URL',
      inputType: 'url',
      outputTypes: ['domain']
    },
    {
      id: 'domain-to-root',
      name: 'Domain to Root Domain',
      description: 'Extracts the registrable root domain (eTLD+1)',
      inputType: 'domain',
      outputTypes: ['domain']
    },
    {
      id: 'domain-to-website',
      name: 'Domain to Website',
      description: 'Creates the website URL entity for the domain',
      inputType: 'domain',
      outputTypes: ['url']
    },
    {
      id: 'domain-wayback',
      name: 'Domain to Wayback URLs',
      description: 'Lists URLs archived by the Wayback Machine for the domain',
      inputType: 'domain',
      outputTypes: ['url']
    },
    {
      id: 'url-http-headers',
      name: 'HTTP Headers / Fingerprint',
      description:
        'Fetches HTTP response headers and detects server technology',
      inputType: 'url',
      outputTypes: ['note', 'organization']
    },
    {
      id: 'url-resolve-ip',
      name: 'Resolve IP',
      description: 'Resolves the IP address of the URL domain',
      inputType: 'url',
      outputTypes: ['ip']
    },
    {
      id: 'url-website-links',
      name: 'Website to Links',
      description: 'Fetches the page and extracts all internal/external links',
      inputType: 'url',
      outputTypes: ['url']
    },
    {
      id: 'url-website-trackers',
      name: 'Website to Webtrackers',
      description:
        'Identifies tracking/analytics scripts (GA, GTM, Meta Pixel, Hotjar, …)',
      inputType: 'url',
      outputTypes: ['organization']
    },
    {
      id: 'url-website-text',
      name: 'Website to Text',
      description: 'Extracts the readable text content of the page',
      inputType: 'url',
      outputTypes: ['note']
    },
    {
      id: 'url-website-crawl',
      name: 'Website Crawler',
      description:
        'Maps the site structure by following internal links (1 level)',
      inputType: 'url',
      outputTypes: ['url']
    }
  ],

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// WHOIS Lookup Plugin
// ============================================

export const whoisPlugin: PluginDefinition = {
  id: 'whois-lookup',
  name: 'WHOIS Lookup',
  description: 'Gets domain registration information via RDAP/WHOIS.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconFileSearch',
  category: 'osint',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['domain'],
  outputTypes: ['organization', 'person', 'note', 'domain'],

  transforms: [
    {
      id: 'whois-lookup',
      name: 'WHOIS Lookup',
      description: 'Gets registrar, owner, registration dates, nameservers',
      inputType: 'domain',
      outputTypes: ['organization', 'person', 'note', 'domain']
    }
  ],

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// Subdomain Finder Plugin
// ============================================

export const subdomainPlugin: PluginDefinition = {
  id: 'subdomain-finder',
  name: 'Subdomain Finder',
  description:
    'Finds subdomains from multiple keyless sources (certSpotter, HackerTarget, crt.sh).',
  version: '1.1.0',
  author: 'PARANOD Team',
  icon: 'IconSitemap',
  category: 'network',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['domain'],
  outputTypes: ['domain', 'ip'],

  transforms: [
    {
      id: 'subdomain-find',
      name: 'Find Subdomains',
      description:
        'Enumerates subdomains via certSpotter + HackerTarget + crt.sh (merged), with passive-DNS IPs',
      inputType: 'domain',
      outputTypes: ['domain', 'ip']
    }
  ],

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// Blockchain Plugin
// ============================================

export const blockchainPlugin: PluginDefinition = {
  id: 'blockchain',
  name: 'Blockchain.com',
  description:
    'Analyze wallet and transactions BTC (Blockchain.com API). Input supported: wallet_btc and transaction (BTC txid: 64 hex, without 0x).',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconWallet',
  logoUrl: '/api/logo?domain=blockchain.com&size=256',
  category: 'blockchain',

  type: 'builtin-js',
  runtime: 'nextjs',

  // Solo BTC (non wallet_eth / solana / tron ecc.)
  inputTypes: ['wallet_btc', 'transaction'],
  outputTypes: ['note', 'transaction', 'wallet_btc'],

  transforms: [
    {
      id: 'wallet-balance',
      name: 'Get Balance',
      description: 'Gets wallet balance and statistics',
      inputType: 'wallet_btc',
      outputTypes: ['note']
    },
    {
      id: 'wallet-transactions',
      name: 'Recent Transactions',
      description: 'Gets the last 10 transactions',
      inputType: 'wallet_btc',
      outputTypes: ['transaction']
    },
    {
      id: 'wallet-connected',
      name: 'Connected Wallets',
      description: 'Finds wallets that interacted with this one',
      inputType: 'wallet_btc',
      outputTypes: ['wallet_btc']
    },
    {
      id: 'tx-counterparties',
      name: 'Get Counterparties',
      description: 'Gets all wallet addresses involved in this transaction',
      inputType: 'transaction',
      outputTypes: ['wallet_btc']
    }
  ],

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// BlockCypher Plugin (ETH)
// ============================================

export const blockcypherPlugin: PluginDefinition = {
  id: 'blockcypher',
  name: 'BlockCypher',
  description:
    'Analyze wallet and transactions ETH (BlockCypher API). Input supported: wallet_eth and transaction (ETH tx: 0x + 64 hex).',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconWallet',
  logoUrl: '/api/logo?domain=blockcypher.com&size=256',
  category: 'blockchain',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['wallet_eth', 'transaction'],
  outputTypes: ['note', 'transaction', 'wallet_eth'],

  transforms: [
    {
      id: 'wallet-balance',
      name: 'Get Balance',
      description: 'Gets wallet balance and statistics',
      inputType: 'wallet_eth',
      outputTypes: ['note']
    },
    {
      id: 'wallet-transactions',
      name: 'Recent Transactions',
      description: 'Gets the last 10 transactions',
      inputType: 'wallet_eth',
      outputTypes: ['transaction']
    },
    {
      id: 'wallet-connected',
      name: 'Connected Wallets',
      description: 'Finds wallets that interacted with this one',
      inputType: 'wallet_eth',
      outputTypes: ['wallet_eth']
    },
    {
      id: 'tx-counterparties',
      name: 'Get Counterparties',
      description: 'Gets all wallet addresses involved in this transaction',
      inputType: 'transaction',
      outputTypes: ['wallet_eth']
    }
  ],

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// Image Analysis Plugin
// ============================================

export const imagePlugin: PluginDefinition = {
  id: 'image-analysis',
  name: 'Image Analysis',
  description:
    'Analyzes images: EXIF extraction, reverse image search, OCR, and perceptual hashing.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconPhoto',
  category: 'media',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['media_url'],
  outputTypes: ['location', 'note', 'url', 'hash'],

  transforms: [
    {
      id: 'image-exif',
      name: 'Extract EXIF Data',
      description: 'Extracts EXIF metadata including GPS coordinates',
      inputType: 'media_url',
      outputTypes: ['location', 'note']
    },
    {
      id: 'image-reverse-search',
      name: 'Reverse Image Search',
      description:
        'Generates links for reverse image search on multiple engines',
      inputType: 'media_url',
      outputTypes: ['url']
    },
    {
      id: 'image-ocr',
      name: 'Extract Text (OCR)',
      description:
        'Sends the image to Google Cloud Vision to extract text (API key required)',
      inputType: 'media_url',
      outputTypes: ['note']
    },
    {
      id: 'image-hash',
      name: 'Generate Image Hash',
      description: 'Creates perceptual hash for duplicate detection',
      inputType: 'media_url',
      outputTypes: ['hash']
    }
  ],

  estimatedTime: 'seconds',
  requiresConfig: false,
  configSchema: {
    ocrApiKey: {
      type: 'string',
      label: 'OCR API Key',
      description: 'Google Cloud Vision API key (optional, for OCR)',
      required: false,
      secret: true
    }
  },
  enabled: true
};

// ============================================
// Video Analysis Plugin
// ============================================

export const videoPlugin: PluginDefinition = {
  id: 'video-analysis',
  name: 'Video Analysis',
  description:
    'Analyzes videos: metadata extraction, thumbnail generation, platform detection.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconVideo',
  category: 'media',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['media_url'],
  outputTypes: ['note', 'media_url', 'domain', 'person', 'url'],

  transforms: [
    {
      id: 'video-metadata',
      name: 'Extract Metadata',
      description: 'Extracts video metadata, author info, and platform details',
      inputType: 'media_url',
      outputTypes: ['note', 'person', 'domain']
    },
    {
      id: 'video-thumbnails',
      name: 'Get Thumbnails',
      description: 'Extracts video thumbnails for analysis',
      inputType: 'media_url',
      outputTypes: ['media_url']
    },
    {
      id: 'video-related',
      name: 'Find Related Content',
      description: 'Generates search links for related video content',
      inputType: 'media_url',
      outputTypes: ['url']
    }
  ],

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// Location Intelligence Plugin
// ============================================

export const locationPlugin: PluginDefinition = {
  id: 'location-intelligence',
  name: 'Location Intelligence',
  description:
    'Location analysis: geocoding, reverse geocoding, nearby places, and map links.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconMapPin',
  category: 'location',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['location'],
  outputTypes: ['location', 'note', 'organization', 'url', 'maps'],

  transforms: [
    {
      id: 'location-geocode',
      name: 'Geocode Address',
      description: 'Converts address to coordinates using OpenStreetMap',
      inputType: 'location',
      outputTypes: ['location']
    },
    {
      id: 'location-reverse',
      name: 'Reverse Geocode',
      description: 'Converts coordinates to address',
      inputType: 'location',
      outputTypes: ['note', 'organization']
    },
    {
      id: 'location-nearby',
      name: 'Find Nearby Places',
      description: 'Searches for points of interest near the location',
      inputType: 'location',
      outputTypes: ['location']
    },
    {
      id: 'location-map-links',
      name: 'Generate Map Links',
      description: 'Creates links to view location on various map services',
      inputType: 'location',
      outputTypes: ['url']
    },
    {
      id: 'location-create-map',
      name: 'Show on Map',
      description: 'Creates an interactive map node to visualize the location',
      inputType: 'location',
      outputTypes: ['maps']
    }
  ],

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// Note Analysis Plugin
// ============================================

export const notePlugin: PluginDefinition = {
  id: 'note-analysis',
  name: 'Note Analysis',
  description:
    'Analyzes notes: entity extraction, keyword analysis, timeline, and web search.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconNote',
  category: 'documents',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['note'],
  outputTypes: [
    'email',
    'domain',
    'ip',
    'phone',
    'wallet',
    'hash',
    'url',
    'social',
    'location',
    'note'
  ],

  transforms: [
    {
      id: 'note-extract-entities',
      name: 'Extract Entities',
      description:
        'Extracts emails, IPs, domains, phones, hashes, wallets from text',
      inputType: 'note',
      outputTypes: [
        'email',
        'domain',
        'ip',
        'phone',
        'wallet',
        'hash',
        'url',
        'social',
        'location'
      ]
    },
    {
      id: 'note-keywords',
      name: 'Analyze Keywords',
      description: 'Extracts and analyzes key terms from the note',
      inputType: 'note',
      outputTypes: ['note']
    },
    {
      id: 'note-search',
      name: 'Search Web',
      description: 'Generates search links to find related content online',
      inputType: 'note',
      outputTypes: ['url']
    },
    {
      id: 'note-timeline',
      name: 'Create Timeline',
      description: 'Extracts dates and creates a timeline from the note',
      inputType: 'note',
      outputTypes: ['note']
    }
  ],

  estimatedTime: 'instant',
  enabled: true
};

// ============================================
// Social Media Plugin
// ============================================

export const socialPlugin: PluginDefinition = {
  id: 'social-media',
  name: 'Social Media',
  description:
    'Analyze social media profiles across platforms: Instagram, Telegram, Facebook.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconBrandTwitter',
  category: 'social',

  type: 'builtin-js',
  runtime: 'nextjs',

  // Support all social types using wildcard
  inputTypes: ['social:*' as any],
  outputTypes: ['note', 'url', 'person'],

  transforms: [
    {
      id: 'social-extract-info',
      name: 'Extract Profile Info',
      description: 'Extracts platform and profile information',
      inputType: 'social:*',
      outputTypes: ['note']
    },
    {
      id: 'social-generate-url',
      name: 'Generate Profile URL',
      description: 'Creates direct link to the social profile',
      inputType: 'social:*',
      outputTypes: ['url']
    },
    {
      id: 'social-search',
      name: 'Search Profile',
      description:
        'Generates search links to find the profile on various engines',
      inputType: 'social:*',
      outputTypes: ['url']
    }
  ],

  estimatedTime: 'instant',
  enabled: true
};

// ============================================
// HudsonRock Plugin — esposizione infostealer (Cavalier, free, no key)
// ============================================

export const hudsonRockPlugin: PluginDefinition = {
  id: 'hudsonrock',
  name: 'HudsonRock',
  description:
    'Checks emails, usernames and domains against infostealer/malware infection data (HudsonRock Cavalier, free).',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconShieldLock',
  category: 'osint',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['email', 'username', 'domain'],
  outputTypes: ['breach'],

  transforms: [
    {
      id: 'hudsonrock-email',
      name: 'Infostealer Exposure (email)',
      description:
        'Checks if the email appears in infostealer/malware infection data.',
      inputType: 'email',
      outputTypes: ['breach']
    },
    {
      id: 'hudsonrock-username',
      name: 'Infostealer Exposure (username)',
      description:
        'Checks if the username appears in infostealer/malware infection data.',
      inputType: 'username',
      outputTypes: ['breach']
    },
    {
      id: 'hudsonrock-domain',
      name: 'Infostealer Exposure (domain)',
      description:
        'Checks a domain for employee/user infostealer exposure (corporate view).',
      inputType: 'domain',
      outputTypes: ['breach']
    }
  ],

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// breach.vip Plugin — ricerca in breach/leak (free API, multi-input)
// ============================================

export const breachVipPlugin: PluginDefinition = {
  id: 'breach-vip',
  name: 'breach.vip',
  description:
    'Searches breach and leak databases (breach.vip free API). Accepts email, username, domain, IP, phone and name.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconDatabaseSearch',
  category: 'osint',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['email', 'username', 'domain', 'ip', 'phone', 'person'],
  outputTypes: ['breach', 'email', 'username', 'credential'],

  transforms: [
    {
      id: 'breachvip-email',
      name: 'Search Breaches (email)',
      description: 'Searches breach databases for records matching the email.',
      inputType: 'email',
      outputTypes: ['breach', 'credential', 'username']
    },
    {
      id: 'breachvip-username',
      name: 'Search Breaches (username)',
      description:
        'Searches breach databases for records matching the username.',
      inputType: 'username',
      outputTypes: ['breach', 'credential', 'email']
    },
    {
      id: 'breachvip-domain',
      name: 'Search Breaches (domain)',
      description: 'Searches breach databases for records under the domain.',
      inputType: 'domain',
      outputTypes: ['breach', 'email', 'credential']
    },
    {
      id: 'breachvip-ip',
      name: 'Search Breaches (IP)',
      description: 'Searches breach databases for records matching the IP.',
      inputType: 'ip',
      outputTypes: ['breach', 'email', 'credential']
    },
    {
      id: 'breachvip-phone',
      name: 'Search Breaches (phone)',
      description: 'Searches breach databases for records matching the phone.',
      inputType: 'phone',
      outputTypes: ['breach', 'email', 'credential']
    },
    {
      id: 'breachvip-name',
      name: 'Search Breaches (name)',
      description: 'Searches breach databases for records matching the name.',
      inputType: 'person',
      outputTypes: ['breach', 'email', 'credential']
    }
  ],

  // OSS: breach.vip è dietro Cloudflare e blocca gli IP datacenter. Se il
  // server ha un IP flaggato, l'utente può instradare le richieste attraverso
  // un proxy con IP pulito.
  requiresConfig: false,
  configSchema: {
    proxyUrl: {
      type: 'string',
      label: 'HTTP proxy URL (optional)',
      description:
        'Route breach.vip through this proxy if your server IP is blocked by Cloudflare (403). Example: http://user:pass@host:8080',
      required: false
    }
  },

  estimatedTime: 'seconds',
  enabled: true
};

// ============================================
// Have I Been Pwned (HIBP) — API key
// ============================================

export const hibpPlugin: PluginDefinition = {
  id: 'hibp',
  name: 'Have I Been Pwned',
  description:
    'Checks emails against the HaveIBeenPwned breach and paste databases.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconShieldLock',
  category: 'identity',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['email'],
  outputTypes: ['breach', 'leak', 'domain'],

  transforms: [
    {
      id: 'hibp-email-breaches',
      name: 'Email to Breaches',
      description: 'Lists data breaches an email appears in (HaveIBeenPwned)',
      inputType: 'email',
      outputTypes: ['breach', 'domain'],
      requiresApiKey: true
    },
    {
      id: 'hibp-email-pastes',
      name: 'Email to Pastes',
      description: 'Lists public pastes an email appears in (HaveIBeenPwned)',
      inputType: 'email',
      outputTypes: ['leak'],
      requiresApiKey: true
    }
  ],

  estimatedTime: 'seconds',
  requiresConfig: true,
  configSchema: {
    apiKey: {
      type: 'string',
      label: 'HIBP API Key',
      description:
        'Your HaveIBeenPwned API v3 key (haveibeenpwned.com/API/Key).',
      required: true,
      secret: true
    }
  },
  enabled: true
};

// ============================================
// Etherscan (Ethereum / EVM) — API key
// ============================================

export const etherscanPlugin: PluginDefinition = {
  id: 'etherscan',
  name: 'Etherscan (Ethereum)',
  description:
    'Ethereum wallet enrichment: balance, transactions and NFTs via Etherscan.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconCurrencyEthereum',
  category: 'blockchain',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['wallet_eth'],
  outputTypes: ['transaction', 'wallet_eth', 'note', 'custom'],

  transforms: [
    {
      id: 'eth-balance',
      name: 'Wallet Balance',
      description: 'Gets the current ETH balance of the wallet',
      inputType: 'wallet_eth',
      outputTypes: ['note'],
      requiresApiKey: true
    },
    {
      id: 'eth-transactions',
      name: 'Wallet to Transactions',
      description: 'Lists recent transactions and counterparty wallets',
      inputType: 'wallet_eth',
      outputTypes: ['transaction', 'wallet_eth'],
      requiresApiKey: true
    },
    {
      id: 'eth-nfts',
      name: 'Wallet to NFTs',
      description: 'Lists NFTs (ERC-721) held/transferred by the wallet',
      inputType: 'wallet_eth',
      outputTypes: ['custom'],
      requiresApiKey: true
    }
  ],

  estimatedTime: 'seconds',
  requiresConfig: true,
  configSchema: {
    apiKey: {
      type: 'string',
      label: 'Etherscan API Key',
      description: 'Your Etherscan API key (etherscan.io/apis). Uses API v2.',
      required: true,
      secret: true
    }
  },
  enabled: true
};

// ============================================
// WHOIS History (WhoisXML) — API key
// ============================================

export const whoisHistoryPlugin: PluginDefinition = {
  id: 'whois-history',
  name: 'WHOIS History',
  description:
    'Historical WHOIS registration records for a domain (WhoisXML API).',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconHistory',
  category: 'network',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['domain', 'url'],
  outputTypes: ['whois_record', 'email', 'organization', 'person'],

  transforms: [
    {
      id: 'whois-history-lookup',
      name: 'Domain History',
      description:
        'Retrieves historical WHOIS records and past registrant details',
      inputType: 'domain',
      outputTypes: ['whois_record', 'email', 'organization', 'person'],
      requiresApiKey: true
    },
    {
      id: 'whois-history-lookup-url',
      name: 'Domain History (from URL)',
      description:
        'Extracts the domain from a URL and retrieves historical WHOIS records',
      inputType: 'url',
      outputTypes: ['whois_record', 'email', 'organization', 'person'],
      requiresApiKey: true
    }
  ],

  estimatedTime: 'seconds',
  requiresConfig: true,
  configSchema: {
    apiKey: {
      type: 'string',
      label: 'WhoisXML API Key',
      description: 'Your WhoisXML API key (whoisxmlapi.com).',
      required: true,
      secret: true
    }
  },
  enabled: true
};

// ============================================
// Disposable Email Domains — keyless (dataset)
// ============================================

export const disposableEmailPlugin: PluginDefinition = {
  id: 'disposable-email',
  name: 'Disposable Email Domains',
  description:
    'Checks whether an email/domain is a disposable or temporary provider (local dataset).',
  version: '1.0.0',
  author: 'disposable-email-domains',
  icon: 'IconTrash',
  category: 'identity',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['email', 'domain'],
  outputTypes: ['note'],

  transforms: [
    {
      id: 'disposable-check-email',
      name: 'Is Disposable? (email)',
      description: 'Checks the email domain against the disposable list',
      inputType: 'email',
      outputTypes: ['note']
    },
    {
      id: 'disposable-check-domain',
      name: 'Is Disposable? (domain)',
      description: 'Checks the domain against the disposable list',
      inputType: 'domain',
      outputTypes: ['note']
    }
  ],

  estimatedTime: 'instant',
  enabled: true
};

// ============================================
// WhatsMyName — username enumeration keyless
// ============================================

export const whatsMyNamePlugin: PluginDefinition = {
  id: 'whatsmyname',
  name: 'WhatsMyName',
  description:
    'Enumerates accounts for a username across 700+ sites (WhatsMyName dataset, keyless).',
  version: '1.0.0',
  author: 'WebBreacher / WhatsMyName',
  icon: 'IconUserSearch',
  category: 'social',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['username'],
  outputTypes: ['social', 'media_url'],

  transforms: [
    {
      id: 'whatsmyname-search',
      name: 'Find Accounts',
      description:
        'Checks the username across 700+ sites and returns found accounts',
      inputType: 'username',
      outputTypes: ['social', 'media_url']
    }
  ],

  estimatedTime: 'minutes',
  enabled: true
};

// ============================================
// EmailRep.io — email reputation (API key)
// ============================================

export const emailRepPlugin: PluginDefinition = {
  id: 'emailrep',
  name: 'EmailRep.io',
  description:
    'Email reputation and risk scoring, linked profiles and breach signals (EmailRep.io).',
  version: '1.0.0',
  author: 'Sublime Security',
  icon: 'IconMailSearch',
  logoUrl: '/api/logo?domain=emailrep.io&size=256',
  category: 'identity',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['email'],
  outputTypes: ['note', 'username'],

  transforms: [
    {
      id: 'emailrep-reputation',
      name: 'Email Reputation',
      description:
        'Gets reputation, risk signals and linked profiles for an email',
      inputType: 'email',
      outputTypes: ['note', 'username'],
      requiresApiKey: true
    }
  ],

  estimatedTime: 'seconds',
  requiresConfig: true,
  configSchema: {
    apiKey: {
      type: 'string',
      label: 'EmailRep API Key',
      description: 'Your EmailRep.io API key (emailrep.io/key).',
      required: true,
      secret: true
    }
  },
  enabled: true
};

// ============================================
// BreachDirectory (RapidAPI) — breach lookup (API key)
// ============================================

export const breachDirectoryPlugin: PluginDefinition = {
  id: 'breachdirectory',
  name: 'BreachDirectory',
  description:
    'Breach lookup for emails and usernames via BreachDirectory (RapidAPI).',
  version: '1.0.0',
  author: 'BreachDirectory',
  icon: 'IconDatabaseSearch',
  logoUrl: '/api/logo?domain=breachdirectory.org&size=256',
  category: 'osint',

  type: 'builtin-js',
  runtime: 'nextjs',

  inputTypes: ['email', 'username'],
  outputTypes: ['breach', 'credential'],

  transforms: [
    {
      id: 'breachdirectory-email',
      name: 'Email to Breaches',
      description: 'Looks up breach records and leaked passwords for an email',
      inputType: 'email',
      outputTypes: ['breach', 'credential'],
      requiresApiKey: true
    },
    {
      id: 'breachdirectory-username',
      name: 'Username to Breaches',
      description:
        'Looks up breach records and leaked passwords for a username',
      inputType: 'username',
      outputTypes: ['breach', 'credential'],
      requiresApiKey: true
    }
  ],

  estimatedTime: 'seconds',
  requiresConfig: true,
  configSchema: {
    apiKey: {
      type: 'string',
      label: 'RapidAPI Key',
      description:
        'Your RapidAPI key subscribed to the BreachDirectory API (rapidapi.com).',
      required: true,
      secret: true
    }
  },
  enabled: true
};

// ============================================
// Container tools (OSINT CLI in container) — pattern runner:
// OSS = LocalDockerRunner (Docker dell'utente, free/self-host)

// UI + menu nodo come plugin; esecuzione via /api/container-tools/<id>/execute.
// ============================================

export const sherlockPlugin: PluginDefinition = {
  id: 'sherlock',
  name: 'Sherlock',
  description: 'Hunts a username across 400+ social networks (container tool).',
  version: '1.0.0',
  author: 'sherlock-project',
  icon: 'IconUserSearch',
  category: 'social',
  type: 'container-tool',
  runtime: 'container',
  inputTypes: ['username'],
  outputTypes: ['social', 'media_url'],
  transforms: [
    {
      id: 'sherlock-search',
      name: 'Find Accounts',
      description: 'Searches the username across 400+ sites (self-hosted)',
      inputType: 'username',
      outputTypes: ['social', 'media_url']
    }
  ],
  estimatedTime: 'minutes',
  enabled: true
};

export const maigretPlugin: PluginDefinition = {
  id: 'maigret',
  name: 'Maigret',
  description:
    'Collects a username profile across 3000+ sites and extracts info (container tool).',
  version: '1.0.0',
  author: 'soxoj',
  icon: 'IconFileSearch',
  category: 'social',
  type: 'container-tool',
  runtime: 'container',
  inputTypes: ['username'],
  outputTypes: ['social', 'media_url'],
  transforms: [
    {
      id: 'maigret-search',
      name: 'Find Accounts',
      description: 'Searches the username across 3000+ sites (self-hosted)',
      inputType: 'username',
      outputTypes: ['social', 'media_url']
    }
  ],
  estimatedTime: 'minutes',
  enabled: true
};

const OSINT_INDUSTRIES_OUTPUTS = [
  'social',
  'github_user',
  'youtube_channel',
  'twitter_user',
  'instagram_user',
  'linkedin_profile',
  'reddit_user',
  'discord_user',
  'tiktok_user',
  'facebook_user',
  'telegram_user',
  'whatsapp_number',
  'signal_number',
  'breach',
  'email',
  'phone',
  'username',
  'ip',
  'domain'
] as const;

export const osintIndustriesPlugin: PluginDefinition = {
  id: 'osint-industries',
  name: 'OSINT Industries',
  description:
    'Looks up emails, phones, usernames, names, wallets, IPs and domains across public sources (OSINT Industries API).',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconRadar',
  category: 'identity',
  type: 'builtin-js',
  runtime: 'nextjs',
  inputTypes: [
    'email',
    'phone',
    'username',
    'person',
    'wallet',
    'ip',
    'domain'
  ],
  outputTypes: [...OSINT_INDUSTRIES_OUTPUTS],
  transforms: [
    {
      id: 'osintind-email',
      name: 'Email to Accounts',
      description: 'Finds public accounts linked to this email',
      inputType: 'email',
      outputTypes: [...OSINT_INDUSTRIES_OUTPUTS],
      requiresApiKey: true
    },
    {
      id: 'osintind-phone',
      name: 'Phone to Accounts',
      description: 'Finds public accounts linked to this phone number',
      inputType: 'phone',
      outputTypes: [...OSINT_INDUSTRIES_OUTPUTS],
      requiresApiKey: true
    },
    {
      id: 'osintind-username',
      name: 'Username to Accounts',
      description: 'Finds public accounts using this username',
      inputType: 'username',
      outputTypes: [...OSINT_INDUSTRIES_OUTPUTS],
      requiresApiKey: true
    },
    {
      id: 'osintind-name',
      name: 'Name to Accounts',
      description: 'Finds public accounts matching this name',
      inputType: 'person',
      outputTypes: [...OSINT_INDUSTRIES_OUTPUTS],
      requiresApiKey: true
    },
    {
      id: 'osintind-wallet',
      name: 'Wallet to Accounts',
      description: 'Finds public accounts linked to this wallet',
      inputType: 'wallet',
      outputTypes: [...OSINT_INDUSTRIES_OUTPUTS],
      requiresApiKey: true
    },
    {
      id: 'osintind-ip',
      name: 'IP Lookup',
      description: 'Where this IP is, who runs it and whether it was flagged',
      inputType: 'ip',
      outputTypes: [...OSINT_INDUSTRIES_OUTPUTS],
      requiresApiKey: true
    },
    {
      id: 'osintind-domain',
      name: 'Domain Lookup',
      description: 'Subdomains, DNS records and history of this domain',
      inputType: 'domain',
      outputTypes: [...OSINT_INDUSTRIES_OUTPUTS],
      requiresApiKey: true
    }
  ],
  estimatedTime: 'seconds',
  requiresConfig: true,
  configSchema: {
    apiKey: {
      type: 'string',
      label: 'OSINT Industries API Key',
      description:
        'API key from an Intermediate or Advanced OSINT Industries subscription (docs.osint.industries).',
      required: true,
      secret: true
    },
    premiumModules: {
      type: 'boolean',
      label: 'Include premium modules',
      description:
        'Also run OSINT Industries premium modules, such as Snapchat and TikTok. Those can cost extra credits on your OSINT Industries account.',
      required: false,
      default: false
    },
    sandbox: {
      type: 'boolean',
      label: 'Sandbox mode (test data)',
      description:
        'Query the OSINT Industries sandbox instead: free, fake results for testing the integration (no IP or domain data). Turn it off for real investigations.',
      required: false,
      default: false
    }
  },
  enabled: true
};

export const holehePlugin: PluginDefinition = {
  id: 'holehe',
  name: 'Holehe',
  description:
    'Checks whether an email is registered on 120+ sites, without alerting the target (container tool).',
  version: '1.0.0',
  author: 'megadose',
  icon: 'IconMailSearch',
  category: 'identity',
  type: 'container-tool',
  runtime: 'container',
  inputTypes: ['email'],
  outputTypes: ['social', 'media_url'],
  transforms: [
    {
      id: 'holehe-search',
      name: 'Email to Registered Sites',
      description: 'Finds sites where the email is registered (self-hosted)',
      inputType: 'email',
      outputTypes: ['social', 'media_url']
    }
  ],
  estimatedTime: 'minutes',
  enabled: true
};

// ============================================
// Registry
// ============================================

export const pluginRegistry: Map<string, PluginDefinition> = new Map([
  [emailHeadersPlugin.id, emailHeadersPlugin],
  [hashEvidencePlugin.id, hashEvidencePlugin],
  [dnsPlugin.id, dnsPlugin],
  [emailPlugin.id, emailPlugin],
  [ipPlugin.id, ipPlugin],
  [urlPlugin.id, urlPlugin],
  [whoisPlugin.id, whoisPlugin],
  [subdomainPlugin.id, subdomainPlugin],
  [blockchainPlugin.id, blockchainPlugin],
  [blockcypherPlugin.id, blockcypherPlugin],
  [imagePlugin.id, imagePlugin],
  [videoPlugin.id, videoPlugin],
  [locationPlugin.id, locationPlugin],
  [notePlugin.id, notePlugin],
  [socialPlugin.id, socialPlugin],
  [hudsonRockPlugin.id, hudsonRockPlugin],
  [breachVipPlugin.id, breachVipPlugin],
  [hibpPlugin.id, hibpPlugin],
  [etherscanPlugin.id, etherscanPlugin],
  [whoisHistoryPlugin.id, whoisHistoryPlugin],
  [disposableEmailPlugin.id, disposableEmailPlugin],
  [whatsMyNamePlugin.id, whatsMyNamePlugin],
  [emailRepPlugin.id, emailRepPlugin],
  [breachDirectoryPlugin.id, breachDirectoryPlugin],
  [osintIndustriesPlugin.id, osintIndustriesPlugin],
  [sherlockPlugin.id, sherlockPlugin],
  [maigretPlugin.id, maigretPlugin],
  [holehePlugin.id, holehePlugin]
]);

// ============================================
// Helper Functions
// ============================================

/**
 * Ottiene tutti i plugin disponibili
 */
export function getAllPlugins(): PluginDefinition[] {
  return Array.from(pluginRegistry.values());
}

/**
 * Ottiene un plugin per ID
 */
export function getPlugin(pluginId: string): PluginDefinition | undefined {
  return pluginRegistry.get(pluginId);
}

/**
 * Ottiene tutti i plugin che accettano un certo tipo di input
 * Supporta anche i nuovi tipi social specifici
 */
export function getPluginsForInputType(
  inputType: EntityType
): PluginDefinition[] {
  return getAllPlugins().filter((plugin) => {
    if (!plugin.enabled) return false;

    // Check if any of the plugin's inputTypes match
    return plugin.inputTypes.some((type) => matchesInputType(inputType, type));
  });
}

/**
 * Helper function to check if an entity type matches an input pattern
 * Supports exact match, 'all', and wildcards like 'social:*', 'telegram:*'
 */
export function matchesInputType(
  entityType: EntityType,
  inputPattern: string
): boolean {
  // Exact match
  if (inputPattern === entityType) return true;

  // Match all types
  if (inputPattern === 'all') return true;

  // Wildcard patterns
  if (inputPattern.includes(':*')) {
    const prefix = inputPattern.replace(':*', '');

    // Permette a pattern tipo 'wallet:*' di matchare anche il tipo base 'wallet'
    if (entityType === (prefix as EntityType)) return true;

    // Category wildcards
    if (prefix === 'social') {
      return isSocialEntityType(entityType);
    }

    // Platform/service-specific wildcards: '<prefix>_*'
    // Examples: telegram:*, instagram:*, facebook:*, twitter:*, github:*, youtube:*
    if (prefix === 'x') return entityType.startsWith('twitter_');
    return entityType.startsWith(`${prefix}_`);
  }

  return false;
}

/**
 * Ottiene tutte le transform disponibili per un tipo di entità
 * @param entityType - Tipo di entità
 * @param enabledPluginIds - Lista opzionale di plugin ID abilitati dall'utente. Se vuota, usa solo plugin.enabled
 */
export function getTransformsForEntityType(
  entityType: EntityType,
  enabledPluginIds?: string[]
): Array<{
  plugin: PluginDefinition;
  transform: TransformDefinition;
}> {
  const results: Array<{
    plugin: PluginDefinition;
    transform: TransformDefinition;
  }> = [];

  for (const plugin of getAllPlugins()) {
    // Se il plugin è disabilitato nel codice, salta
    if (!plugin.enabled) continue;

    // Se abbiamo una lista di plugin abilitati, usa quella
    if (enabledPluginIds && !enabledPluginIds.includes(plugin.id)) continue;

    // Applica anche i vincoli inputTypes del plugin (oltre a quelli della transform)
    const pluginAcceptsEntityType = plugin.inputTypes.some((type) =>
      matchesInputType(entityType, String(type))
    );
    if (!pluginAcceptsEntityType) continue;

    for (const transform of plugin.transforms) {
      // Use the new matching logic that supports wildcards
      if (matchesInputType(entityType, transform.inputType)) {
        results.push({ plugin, transform });
      }
    }
  }

  return results;
}

/**
 * Trova una transform specifica
 */
export function findTransform(
  pluginId: string,
  transformId: string
): { plugin: PluginDefinition; transform: TransformDefinition } | undefined {
  const plugin = getPlugin(pluginId);
  if (!plugin) return undefined;

  const transform = plugin.transforms.find((t) => t.id === transformId);
  if (!transform) return undefined;

  return { plugin, transform };
}
