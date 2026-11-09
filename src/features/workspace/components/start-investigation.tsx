'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { useWorkspaceTabsStore } from '../store/workspace-tabs-store';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from '@/components/ui/popover';
import {
  ArrowsSplitIcon as FlowIcon,
  CaretDownIcon as CaretDown,
  CaretRightIcon as IconChevronRight,
  CheckIcon as Check,
  MagnifyingGlassIcon as MagnifyingGlass,
  GraphIcon as IconGraph,
  FolderOpenIcon as IconCase,
  NoteIcon as NoteIcon,
  PlusIcon as Plus,
  SparkleIcon as Sparkle
} from '@/components/icons';
import { cn } from '@/lib/utils';
import type { NodeType } from '@/features/osint/node-registry';

interface StartInvestigationProps {
  tabId?: string;
  className?: string;
}

interface GraphListItem {
  id: string;
  name: string;
  description: string | null;
  caseId: string;
  caseName: string;
  lastOpenedAt: string | null;
  updatedAt: string;
}

interface CaseListItem {
  id: string;
  name: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}

interface FlowListItem {
  id: string;
  name: string;
  description: string | null;
  lastOpenedAt: string | null;
  updatedAt: string;
}

interface NoteListItem {
  id: string;
  name: string;
  caseId: string;
  caseName: string;
  lastOpenedAt: string | null;
  updatedAt: string;
}

type RecentResourceKind = 'case' | 'graph' | 'note' | 'flow';

interface RecentResource {
  kind: RecentResourceKind;
  id: string;
  name: string;
  caseId?: string;
  caseName?: string;
  lastOpenedAt: string | null;
  updatedAt: string;
}

const ACTIVE_CASE_KEY = 'paranod-active-case-v1';

function normalizeString(value: string) {
  return value.trim();
}

function safeLower(value: string) {
  return value.toLowerCase();
}

function stripWrapping(value: string) {
  let v = value.trim();
  const pairs: Array<[string, string]> = [
    ['<', '>'],
    ['(', ')'],
    ['[', ']'],
    ['{', '}'],
    ['"', '"'],
    ["'", "'"]
  ];

  // Rimuove wrapping singolo più comune: "<...>", "(...)", "...", ecc.
  for (const [a, b] of pairs) {
    if (
      v.startsWith(a) &&
      v.endsWith(b) &&
      v.length >= a.length + b.length + 1
    ) {
      v = v.slice(a.length, v.length - b.length).trim();
    }
  }

  // Rimuove punteggiatura finale tipica quando si incolla da testo.
  v = v.replace(/[),.;:]+$/g, '').trim();
  return v;
}

function parseIpv4Candidate(value: string): string | null {
  const raw = value.trim();
  const withoutPort = raw.includes(':') ? (raw.split(':')[0] ?? raw) : raw;
  const parts = withoutPort.split('.');
  if (parts.length !== 4) return null;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n < 0 || n > 255) return null;
  }
  return withoutPort;
}

function parseIpv6Candidate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  // Supporta forma [ipv6]:port
  let v = raw;
  if (v.startsWith('[')) {
    const end = v.indexOf(']');
    if (end < 0) return null;
    v = v.slice(1, end);
  }

  // Rimuove zone id (es: fe80::1%eth0)
  v = v.split('%')[0] ?? v;
  v = (v ?? '').trim().toLowerCase();
  if (!v) return null;

  // IPv6 deve contenere almeno due ':' per ridurre falsi positivi (es MAC)
  const colonCount = (v.match(/:/g) ?? []).length;
  if (colonCount < 2) return null;

  // Caratteri permessi: hex, ':', '.' (per IPv4-mapped)
  if (!/^[0-9a-f:.]+$/.test(v)) return null;

  const parts = v.split('::');
  if (parts.length > 2) return null;
  const left = parts[0] ?? '';
  const right = parts[1] ?? '';

  function countGroups(side: string) {
    if (!side) return 0;
    const segs = side.split(':');
    let groups = 0;
    for (const seg of segs) {
      if (!seg) return -1;
      if (seg.includes('.')) {
        const ipv4 = parseIpv4Candidate(seg);
        if (!ipv4) return -1;
        groups += 2; // IPv4-mapped conta come 2 gruppi da 16 bit
        continue;
      }
      if (seg.length < 1 || seg.length > 4) return -1;
      if (!/^[0-9a-f]+$/.test(seg)) return -1;
      groups += 1;
    }
    return groups;
  }

  const leftGroups = countGroups(left);
  if (leftGroups < 0) return null;
  const rightGroups = countGroups(right);
  if (rightGroups < 0) return null;

  const total = leftGroups + rightGroups;
  // senza '::' devono essere esattamente 8 gruppi
  if (parts.length === 1) {
    if (total !== 8) return null;
    return v;
  }
  // con '::' può comprimere almeno 1 gruppo, quindi total < 8 è ok
  if (total >= 8) return null;
  return v;
}

function parseUuidCandidate(value: string) {
  const v = value.trim();
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      v
    )
  )
    return v.toLowerCase();
  return null;
}

function parseAsnCandidate(value: string) {
  const v = value.trim().toUpperCase();
  if (/^AS\d{1,10}$/.test(v)) return v;
  return null;
}

function parseMacCandidate(value: string) {
  const v = value.trim();
  if (/^([0-9a-f]{2}[:-]){5}[0-9a-f]{2}$/i.test(v)) return v.toLowerCase();
  if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(v))
    return v.toLowerCase();
  return null;
}

function normalizeCompactUpper(value: string) {
  return value.replace(/\s+/g, '').toUpperCase();
}

function parseIbanCandidate(value: string) {
  const v = normalizeCompactUpper(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(v)) return null;
  // Controllo semplice: lunghezza totale 15..34 (standard IBAN)
  if (v.length < 15 || v.length > 34) return null;
  return v;
}

function parsePhoneDigitsCandidate(value: string) {
  const digits = value.replace(/[^\d+]/g, '');
  if (!digits) return null;

  const normalized = digits.startsWith('+')
    ? `+${digits.slice(1).replace(/\D/g, '')}`
    : digits.replace(/\D/g, '');
  const len = normalized.startsWith('+')
    ? normalized.length - 1
    : normalized.length;
  if (len < 7 || len > 15) return null; // E.164 practical range
  return normalized;
}

function isLikelyHex(value: string) {
  return /^[0-9a-f]+$/i.test(value);
}

function parseHashCandidate(value: string) {
  const v = value.trim();
  const raw = v.startsWith('0x') ? v.slice(2) : v;
  if (!raw || !isLikelyHex(raw)) return null;
  const len = raw.length;
  if (len === 32 || len === 40 || len === 64 || len === 128) return v;
  return null;
}

function parseEthAddressCandidate(value: string) {
  const v = value.trim();
  if (/^0x[0-9a-f]{40}$/i.test(v)) return v;
  return null;
}

function parseEthTxCandidate(value: string) {
  const v = value.trim();
  if (/^0x[0-9a-f]{64}$/i.test(v)) return v;
  return null;
}

function parseTxIdCandidate(value: string) {
  const v = value.trim();
  const raw = v.startsWith('0x') ? v.slice(2) : v;
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw))
    return v.startsWith('0x') ? v : raw.toLowerCase();
  return null;
}

function parseWalletCandidate(
  value: string
): { type: NodeType; label: string } | null {
  const v = value.trim();
  if (!v) return null;

  // ETH already handled elsewhere; keep here too as fallback.
  if (/^0x[0-9a-f]{40}$/i.test(v)) return { type: 'wallet_eth', label: v };

  // BTC bech32
  if (/^bc1[ac-hj-np-z02-9]{11,71}$/i.test(v))
    return { type: 'wallet_btc', label: v };
  // LTC bech32
  if (/^ltc1[ac-hj-np-z02-9]{11,71}$/i.test(v))
    return { type: 'wallet_ltc', label: v };

  // Base58 (BTC legacy, many chains)
  if (/^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(v))
    return { type: 'wallet_btc', label: v }; // BTC P2PKH/P2SH
  if (/^[LM3][a-km-zA-HJ-NP-Z1-9]{26,33}$/.test(v))
    return { type: 'wallet_ltc', label: v }; // LTC legacy

  // TRON
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(v))
    return { type: 'wallet_tron', label: v };

  // SOL / generic base58 (heuristic, can overlap): 32..44 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(v))
    return { type: 'wallet_solana', label: v };

  return null;
}

function luhnCheck(digits: string) {
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const c = digits[i];
    if (!c) return false;
    const n = Number(c);
    if (!Number.isFinite(n)) return false;
    let add = n;
    if (shouldDouble) {
      add = n * 2;
      if (add > 9) add -= 9;
    }
    sum += add;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function parseCreditCardCandidate(value: string) {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length < 13 || digits.length > 19) return null;
  if (!luhnCheck(digits)) return null;
  return digits;
}

function parseStripeCustomerCandidate(value: string) {
  const v = value.trim();
  if (/^cus_[A-Za-z0-9]+$/.test(v)) return v;
  return null;
}

function looksLikePhoneRaw(value: string) {
  const v = value.trim();
  if (!v) return false;
  // Solo caratteri tipici dei numeri (niente lettere: evita bc1..., cus_, ecc.)
  if (!/^[+\d][\d\s().-]{6,}$/.test(v)) return false;
  const digitsCount = (v.match(/\d/g) ?? []).length;
  return digitsCount >= 7 && digitsCount <= 15;
}

function parseExplicitNumberPrefix(value: string): {
  type: 'phone' | 'whatsapp_number' | 'signal_number';
  label: string;
  hint: string;
} | null {
  const v = value.trim();
  const m = v.match(/^(whatsapp|wa|signal|tel|phone):\s*(.+)$/i);
  if (!m) return null;

  const prefix = (m[1] ?? '').toLowerCase();
  const rest = (m[2] ?? '').trim();
  if (!rest) return null;

  const digits = rest.replace(/[^\d+]/g, '');
  if (!digits) return null;

  if (prefix === 'whatsapp' || prefix === 'wa')
    return { type: 'whatsapp_number', label: digits, hint: 'WhatsApp' };
  if (prefix === 'signal')
    return { type: 'signal_number', label: digits, hint: 'Signal' };
  return { type: 'phone', label: digits, hint: 'Phone' };
}

function parseHttpRequestCandidate(value: string) {
  const v = value.trim();
  // Es: "GET /path HTTP/1.1"
  if (
    /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+HTTP\/\d(\.\d)?$/i.test(
      v
    )
  )
    return v;
  return null;
}

function parseHttpResponseCandidate(value: string) {
  const v = value.trim();
  // Es: "HTTP/1.1 200 OK"
  if (/^HTTP\/\d(\.\d)?\s+\d{3}(\s+.+)?$/i.test(v)) return v;
  return null;
}

function parseDnsRecordCandidate(value: string) {
  const v = value.trim();
  // Es: "A example.com 1.2.3.4", "TXT example.com \"foo\""
  if (/^(A|AAAA|CNAME|MX|NS|TXT|SRV|PTR)\s+\S+\s+.+$/i.test(v)) return v;
  return null;
}

function pickFirstPathSegment(pathname: string) {
  const seg = pathname.split('/').filter(Boolean)[0];
  return seg ?? null;
}

function parseHostnameCandidate(value: string) {
  const v = value.trim();
  if (!v) return null;
  if (!/^[a-z0-9-]{1,63}$/i.test(v)) return null;
  if (v.startsWith('-') || v.endsWith('-')) return null;
  return v;
}

function getFileExtensionFromPath(pathname: string) {
  const last = pathname.split('/').filter(Boolean).pop();
  if (!last) return null;
  const parts = last.split('.');
  if (parts.length < 2) return null;
  const ext = parts.pop();
  if (!ext) return null;
  return ext.toLowerCase();
}

function inferFromUrl(
  value: string
): { type: NodeType; label: string; hint: string } | null {
  const raw = value.trim();
  const lower = raw.toLowerCase();

  let url: URL;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
    url = new URL(hasScheme ? raw : `https://${raw}`);
  } catch {
    return null;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  const pathname = url.pathname || '/';
  const pathSegs = pathname.split('/').filter(Boolean);
  const firstSeg = pathSegs[0] ?? '';

  // File types
  const ext = getFileExtensionFromPath(pathname);
  if (ext === 'pdf') return { type: 'pdf', label: raw, hint: 'PDF' };
  if (ext === 'docx') return { type: 'docx', label: raw, hint: 'Word' };
  if (ext === 'xlsx') return { type: 'xlsx', label: raw, hint: 'Excel' };
  if (ext === 'csv') return { type: 'csv', label: raw, hint: 'CSV' };
  if (ext === 'json') return { type: 'json', label: raw, hint: 'JSON' };
  if (ext === 'txt') return { type: 'txt', label: raw, hint: 'Text File' };

  if (
    ext &&
    /^(png|jpe?g|gif|webp|svg|mp4|mov|m4v|webm|mp3|wav|m4a|ogg)$/i.test(ext)
  )
    return { type: 'media_url', label: raw, hint: 'Media URL' };

  // Maps
  if (
    hostname.includes('google.') &&
    (pathname.startsWith('/maps') ||
      pathname.startsWith('/search') ||
      pathname.startsWith('/place'))
  )
    return { type: 'maps', label: raw, hint: 'Map' };
  if (hostname === 'maps.app.goo.gl' || hostname === 'goo.gl')
    return { type: 'maps', label: raw, hint: 'Map' };
  if (hostname.includes('openstreetmap.workspace'))
    return { type: 'maps', label: raw, hint: 'Map' };

  // PayPal
  if (hostname === 'paypal.me') {
    const handle = pickFirstPathSegment(pathname);
    return { type: 'paypal_account', label: handle ?? raw, hint: 'PayPal' };
  }

  // WhatsApp
  if (hostname === 'wa.me') {
    const num = pickFirstPathSegment(pathname);
    return { type: 'whatsapp_number', label: num ?? raw, hint: 'WhatsApp' };
  }
  if (hostname.endsWith('whatsapp.com'))
    return { type: 'whatsapp_number', label: raw, hint: 'WhatsApp' };

  // Signal
  if (hostname === 'signal.me')
    return { type: 'signal_number', label: raw, hint: 'Signal' };

  // Telegram
  if (hostname === 't.me' || hostname === 'telegram.me') {
    const handle = pickFirstPathSegment(pathname);
    if (!handle)
      return { type: 'telegram_channel', label: raw, hint: 'Telegram' };
    if (handle.toLowerCase() === 'joinchat')
      return { type: 'telegram_group', label: raw, hint: 'Telegram Group' };
    return {
      type: 'telegram_channel',
      label: handle.replace(/^@/, ''),
      hint: 'Telegram Channel'
    };
  }

  // X / Twitter
  if (hostname === 'x.com' || hostname === 'twitter.com') {
    if (pathname.includes('/status/'))
      return { type: 'twitter_post', label: raw, hint: 'X Post' };
    if (firstSeg)
      return {
        type: 'twitter_user',
        label: firstSeg.replace(/^@/, ''),
        hint: 'X User'
      };
  }

  // Instagram
  if (hostname === 'instagram.com') {
    if (
      pathname.startsWith('/p/') ||
      pathname.startsWith('/reel/') ||
      pathname.startsWith('/tv/')
    )
      return { type: 'instagram_post', label: raw, hint: 'Instagram Post' };
    if (firstSeg)
      return {
        type: 'instagram_user',
        label: firstSeg.replace(/^@/, ''),
        hint: 'Instagram User'
      };
  }

  // Facebook
  if (hostname === 'facebook.com' || hostname === 'm.facebook.com') {
    if (pathname.startsWith('/groups/')) {
      const groupId = pathSegs[1];
      return {
        type: 'facebook_group',
        label: groupId ?? raw,
        hint: 'Facebook Group'
      };
    }
    if (pathname.startsWith('/profile.php') && url.searchParams.get('id'))
      return {
        type: 'facebook_user',
        label: url.searchParams.get('id') ?? raw,
        hint: 'Facebook User'
      };
    if (firstSeg)
      return { type: 'facebook_user', label: firstSeg, hint: 'Facebook User' };
  }

  // LinkedIn
  if (hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')) {
    if (pathname.startsWith('/in/') && pathSegs[1])
      return {
        type: 'linkedin_profile',
        label: pathSegs[1],
        hint: 'LinkedIn Profile'
      };
    if (firstSeg)
      return { type: 'linkedin_profile', label: raw, hint: 'LinkedIn Profile' };
  }

  // GitHub
  if (hostname === 'github.com') {
    const user = pathSegs[0];
    const repo = pathSegs[1];
    if (user && repo)
      return {
        type: 'github_repo',
        label: `${user}/${repo}`,
        hint: 'GitHub Repository'
      };
    if (user) return { type: 'github_user', label: user, hint: 'GitHub User' };
  }

  // Blockchain explorers (wallet/tx)
  if (hostname.endsWith('etherscan.io')) {
    if (pathname.startsWith('/tx/') && pathSegs[1])
      return { type: 'transaction', label: pathSegs[1], hint: 'Transaction' };
    if (pathname.startsWith('/address/') && pathSegs[1])
      return { type: 'wallet_eth', label: pathSegs[1], hint: 'Wallet' };
  }
  if (hostname.endsWith('blockchair.com')) {
    if (pathname.includes('/transaction/') && pathSegs.includes('transaction'))
      return { type: 'transaction', label: raw, hint: 'Transaction' };
    if (pathname.includes('/address/') && pathSegs.includes('address'))
      return { type: 'wallet', label: raw, hint: 'Wallet' };
  }
  if (hostname.endsWith('blockstream.info')) {
    if (pathname.startsWith('/tx/') && pathSegs[1])
      return { type: 'transaction', label: pathSegs[1], hint: 'Transaction' };
    if (pathname.startsWith('/address/') && pathSegs[1])
      return { type: 'wallet_btc', label: pathSegs[1], hint: 'Wallet' };
  }

  // GitLab
  if (hostname === 'gitlab.com') {
    const user = pathSegs[0];
    if (user) return { type: 'gitlab_user', label: user, hint: 'GitLab User' };
  }

  // YouTube
  if (hostname === 'youtu.be') {
    const id = pickFirstPathSegment(pathname);
    return { type: 'youtube_video', label: id ?? raw, hint: 'YouTube Video' };
  }
  if (hostname.endsWith('youtube.com')) {
    if (pathname === '/watch' && url.searchParams.get('v'))
      return {
        type: 'youtube_video',
        label: url.searchParams.get('v') ?? raw,
        hint: 'YouTube Video'
      };
    if (pathname.startsWith('/shorts/') && pathSegs[1])
      return {
        type: 'youtube_video',
        label: pathSegs[1],
        hint: 'YouTube Video'
      };
    if (pathname.startsWith('/channel/') && pathSegs[1])
      return {
        type: 'youtube_channel',
        label: pathSegs[1],
        hint: 'YouTube Channel'
      };
    if (pathname.startsWith('/@') && firstSeg)
      return {
        type: 'youtube_channel',
        label: firstSeg.replace(/^@/, ''),
        hint: 'YouTube Channel'
      };
  }

  // TikTok
  if (hostname.endsWith('tiktok.com')) {
    if (pathname.includes('/video/'))
      return { type: 'tiktok_video', label: raw, hint: 'TikTok Video' };
    if (pathname.startsWith('/@') && firstSeg)
      return {
        type: 'tiktok_user',
        label: firstSeg.replace(/^@/, ''),
        hint: 'TikTok User'
      };
  }

  // Reddit
  if (hostname === 'redd.it')
    return { type: 'reddit_post', label: raw, hint: 'Reddit Post' };
  if (hostname.endsWith('reddit.com')) {
    if (pathname.startsWith('/user/') && pathSegs[1])
      return { type: 'reddit_user', label: pathSegs[1], hint: 'Reddit User' };
    if (pathname.includes('/comments/'))
      return { type: 'reddit_post', label: raw, hint: 'Reddit Post' };
  }

  // Discord
  if (hostname === 'discord.gg') {
    const invite = pickFirstPathSegment(pathname);
    return {
      type: 'discord_server',
      label: invite ?? raw,
      hint: 'Discord Server'
    };
  }
  if (
    hostname.endsWith('discord.com') &&
    pathname.startsWith('/channels/') &&
    pathSegs[1]
  )
    return {
      type: 'discord_server',
      label: pathSegs[1],
      hint: 'Discord Server'
    };

  // Slack
  if (hostname.endsWith('.slack.com')) {
    const workspace = hostname.replace(/\.slack\.com$/, '');
    if (pathname.startsWith('/archives/') && pathSegs[1])
      return {
        type: 'slack_channel',
        label: pathSegs[1],
        hint: 'Slack Channel'
      };
    return {
      type: 'slack_workspace',
      label: workspace,
      hint: 'Slack Workspace'
    };
  }

  // Generic URL vs domain/subdomain/hostname decision
  const looksLikeUrl =
    raw.includes('/') ||
    raw.includes('?') ||
    raw.includes('#') ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ||
    lower.startsWith('www.');
  if (looksLikeUrl) return { type: 'url', label: raw, hint: 'URL' };

  const host = hostname;
  const ipv4 = parseIpv4Candidate(host);
  if (ipv4) return { type: 'ip', label: ipv4, hint: 'IP' };

  const labels = host.split('.').filter(Boolean);
  if (labels.length >= 3)
    return { type: 'subdomain', label: host, hint: 'Subdomain' };
  if (labels.length === 2)
    return { type: 'domain', label: host, hint: 'Domain' };

  return null;
}

function guessNodeTypeFromQuery(value: string): {
  type: NodeType;
  label: string;
  hint: string;
} {
  const q0 = normalizeString(value);
  const q = stripWrapping(q0);
  if (!q) return { type: 'custom', label: '', hint: 'Custom' };

  // Prefix espliciti (whatsapp:, signal:, tel:)
  const prefixed = parseExplicitNumberPrefix(q);
  if (prefixed) return prefixed;

  // Prefix espliciti per tx
  const txPrefix = q.match(/^(tx|txn|transaction):\s*(.+)$/i);
  if (txPrefix) {
    const tx = parseTxIdCandidate((txPrefix[2] ?? '').trim());
    if (tx) return { type: 'transaction', label: tx, hint: 'Transaction' };
  }

  // Wallet/tx "raw" prima del phone (evita che bc1... diventi phone)
  const ethTxEarly = parseEthTxCandidate(q);
  if (ethTxEarly)
    return { type: 'transaction', label: ethTxEarly, hint: 'Transaction' };
  const txIdEarly = parseTxIdCandidate(q);
  if (txIdEarly)
    return { type: 'transaction', label: txIdEarly, hint: 'Transaction' };
  const ethAddrEarly = parseEthAddressCandidate(q);
  if (ethAddrEarly)
    return { type: 'wallet_eth', label: ethAddrEarly, hint: 'Wallet' };
  const walletEarly = parseWalletCandidate(q);
  if (walletEarly)
    return { type: walletEarly.type, label: walletEarly.label, hint: 'Wallet' };

  // Numero "nudo" -> Phone (solo se non contiene lettere)
  if (looksLikePhoneRaw(q) && !q.includes('.')) {
    const phoneDigits = parsePhoneDigitsCandidate(q);
    if (phoneDigits)
      return { type: 'phone', label: phoneDigits, hint: 'Phone' };
  }

  // SSL certificate (PEM)
  if (
    q.includes('-----BEGIN CERTIFICATE-----') &&
    q.includes('-----END CERTIFICATE-----')
  )
    return { type: 'ssl_certificate', label: q, hint: 'SSL Certificate' };

  // HTTP request/response (first-line)
  const httpRes = parseHttpResponseCandidate(q);
  if (httpRes)
    return { type: 'http_response', label: httpRes, hint: 'HTTP Response' };
  const httpReq = parseHttpRequestCandidate(q);
  if (httpReq)
    return { type: 'http_request', label: httpReq, hint: 'HTTP Request' };

  // DNS record (single-line)
  const dns = parseDnsRecordCandidate(q);
  if (dns) return { type: 'dns_record', label: dns, hint: 'DNS Record' };

  // Lat,Lng
  const coordMatch = q.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (coordMatch)
    return {
      type: 'location',
      label: `${coordMatch[1]}, ${coordMatch[2]}`,
      hint: 'Location'
    };

  // Email / mailto:
  const mail = q.toLowerCase().startsWith('mailto:')
    ? q.slice('mailto:'.length).trim()
    : q;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail))
    return { type: 'email', label: mail, hint: 'Email' };

  // URL-based inference (social/services + file types + map)
  const inferred = inferFromUrl(q);
  if (inferred) return inferred;

  // IPv4 (incl. :port)
  const ipv4 = parseIpv4Candidate(q);
  if (ipv4) return { type: 'ip', label: ipv4, hint: 'IP' };

  // MAC
  const mac = parseMacCandidate(q);
  if (mac) return { type: 'mac_address', label: mac, hint: 'MAC Address' };

  // IPv6 (incl. [ipv6]:port)
  const ipv6 = parseIpv6Candidate(q);
  if (ipv6) return { type: 'ip', label: ipv6, hint: 'IP' };

  // ASN
  const asn = parseAsnCandidate(q);
  if (asn) return { type: 'asn', label: asn, hint: 'ASN' };

  // IBAN
  const iban = parseIbanCandidate(q);
  if (iban) return { type: 'iban', label: iban, hint: 'IBAN' };

  // Stripe customer
  const stripeCustomer = parseStripeCustomerCandidate(q);
  if (stripeCustomer)
    return {
      type: 'stripe_customer',
      label: stripeCustomer,
      hint: 'Stripe Customer'
    };

  // Credit card (Luhn)
  const card = parseCreditCardCandidate(q);
  if (card) return { type: 'credit_card', label: card, hint: 'Card' };

  // Blockchain: tx/address (priorità)
  const ethTx = parseEthTxCandidate(q);
  if (ethTx) return { type: 'transaction', label: ethTx, hint: 'Transaction' };
  const txId = parseTxIdCandidate(q);
  if (txId) return { type: 'transaction', label: txId, hint: 'Transaction' };
  const ethAddr = parseEthAddressCandidate(q);
  if (ethAddr) return { type: 'wallet_eth', label: ethAddr, hint: 'Wallet' };
  const wallet = parseWalletCandidate(q);
  if (wallet) return { type: wallet.type, label: wallet.label, hint: 'Wallet' };

  // Hash (md5/sha1/sha256/sha512)
  const hash = parseHashCandidate(q);
  if (hash) return { type: 'hash', label: hash, hint: 'Hash' };

  // Credential (user:pass) — evita URL scheme e spazi
  if (
    /^[^\s:]{1,64}:[^\s]{1,128}$/.test(q) &&
    !/^[a-z][a-z0-9+.-]*:\/\//i.test(q)
  )
    return { type: 'credential', label: q, hint: 'Credential' };

  // UUID come user_id (euristica)
  const uuid = parseUuidCandidate(q);
  if (uuid) return { type: 'user_id', label: uuid, hint: 'User ID' };

  // Phone (generico)
  if (/^\+?[0-9][0-9\s().-]{6,}$/.test(q)) {
    const digits = parsePhoneDigitsCandidate(q);
    if (digits) return { type: 'phone', label: digits, hint: 'Phone' };
  }

  // @handle => Social generic profile
  if (/^@[a-zA-Z0-9_\.]{3,}$/.test(q))
    return { type: 'social', label: q.slice(1), hint: 'Social Profile' };

  // Username (fallback)
  if (/^[a-zA-Z0-9_]{3,}$/.test(q))
    return { type: 'username', label: q, hint: 'Username' };

  // Hostname (fallback) - solo dopo username
  const hostname = parseHostnameCandidate(q);
  if (hostname) return { type: 'hostname', label: hostname, hint: 'Hostname' };

  return { type: 'custom', label: q, hint: 'Custom' };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sortByRecency<
  T extends { lastOpenedAt: string | null; updatedAt: string }
>(items: T[]) {
  return [...items].sort((a, b) => {
    const aTimestamp = new Date(a.lastOpenedAt ?? a.updatedAt).getTime();
    const bTimestamp = new Date(b.lastOpenedAt ?? b.updatedAt).getTime();
    return bTimestamp - aTimestamp;
  });
}

function formatRecency(value: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;

  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60]
  ];

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return 'just now';
}

function ResourceIcon({
  kind,
  className
}: {
  kind: RecentResourceKind;
  className?: string;
}) {
  if (kind === 'case') return <IconCase className={className} />;
  if (kind === 'graph') return <IconGraph className={className} />;
  if (kind === 'note') return <NoteIcon className={className} />;
  return <FlowIcon className={cn('-rotate-90', className)} />;
}

function RecentWidget({
  title,
  kind,
  items,
  onOpen,
  onTitleClick,
  emptyLabel
}: {
  title: string;
  kind: RecentResourceKind;
  items: RecentResource[];
  onOpen: (item: RecentResource) => void;
  onTitleClick: () => void;
  emptyLabel: string;
}) {
  return (
    <section
      className='border-border/50 bg-card/20 min-w-0 rounded-lg border'
      aria-label={title}
    >
      <button
        type='button'
        onClick={onTitleClick}
        className='border-border/40 hover:bg-accent focus-visible:ring-ring flex h-11 w-full items-center gap-2.5 rounded-t-lg border-b px-4 text-left outline-none focus-visible:ring-1'
        aria-label={`Open ${title}`}
      >
        <ResourceIcon
          kind={kind}
          className='text-muted-foreground size-[18px]'
        />
        <h2 className='min-w-0 flex-1 truncate text-sm font-semibold'>
          {title}
        </h2>
        <IconChevronRight className='text-muted-foreground size-4' />
      </button>
      <div className='p-2'>
        {items.length > 0 ? (
          items.map((item) => {
            const recency = formatRecency(
              item.lastOpenedAt ?? item.updatedAt ?? null
            );
            const context =
              item.kind === 'flow'
                ? 'Workspace flow'
                : item.kind === 'case'
                  ? 'Case'
                  : item.caseName;

            return (
              <button
                key={`${item.kind}:${item.id}`}
                type='button'
                onClick={() => onOpen(item)}
                className='hover:bg-accent focus-visible:ring-ring flex h-16 w-full min-w-0 items-center gap-3 rounded-md px-2.5 text-left outline-none focus-visible:ring-1'
              >
                <ResourceIcon
                  kind={item.kind}
                  className='text-muted-foreground size-[18px] shrink-0'
                />
                <span className='min-w-0 flex-1'>
                  <span className='block truncate text-sm font-medium'>
                    {item.name}
                  </span>
                  <span className='text-muted-foreground block truncate text-xs'>
                    {[context, recency].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <IconChevronRight className='text-muted-foreground size-4 shrink-0' />
              </button>
            );
          })
        ) : (
          <div className='text-muted-foreground flex h-16 items-center px-2.5 text-sm'>
            {emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

export function StartInvestigation({
  tabId,
  className
}: StartInvestigationProps) {
  const router = useRouter();
  const openTab = useWorkspaceTabsStore((s) => s.openTab);
  const closeTab = useWorkspaceTabsStore((s) => s.closeTab);

  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [graphs, setGraphs] = useState<GraphListItem[]>([]);
  const [cases, setCases] = useState<CaseListItem[]>([]);
  const [flows, setFlows] = useState<FlowListItem[]>([]);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingNotes, setIsLoadingNotes] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [casePickerOpen, setCasePickerOpen] = useState(false);
  const [caseFilter, setCaseFilter] = useState('');
  const [createCaseOpen, setCreateCaseOpen] = useState(false);
  const [newCaseName, setNewCaseName] = useState('');
  const [newCaseDescription, setNewCaseDescription] = useState('');
  const [isCreatingCase, setIsCreatingCase] = useState(false);

  const loadWorkspaceData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [graphResponse, caseResponse, flowResponse] = await Promise.all([
        fetch('/api/graphs', { cache: 'no-store' }),
        fetch('/api/cases', { cache: 'no-store' }),
        fetch('/api/flows', { cache: 'no-store' })
      ]);

      if (!graphResponse.ok || !caseResponse.ok || !flowResponse.ok) {
        throw new Error('workspace_load_failed');
      }

      const [graphJson, caseJson, flowJson] = await Promise.all([
        graphResponse.json(),
        caseResponse.json(),
        flowResponse.json()
      ]);

      const nextCases: CaseListItem[] = (
        Array.isArray(caseJson?.cases) ? caseJson.cases : []
      ).flatMap((raw: unknown) => {
        const item = asRecord(raw);
        if (
          !item ||
          typeof item.id !== 'string' ||
          typeof item.name !== 'string' ||
          item.status === 'archived'
        ) {
          return [];
        }
        return [
          {
            id: item.id,
            name: item.name,
            updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : '',
            lastOpenedAt:
              typeof item.lastOpenedAt === 'string' ? item.lastOpenedAt : null
          }
        ];
      });

      setCases(nextCases);
      setGraphs(
        (Array.isArray(graphJson?.graphs) ? graphJson.graphs : []).flatMap(
          (raw: unknown) => {
            const item = asRecord(raw);
            const graphCase = asRecord(item?.case);
            if (
              !item ||
              typeof item.id !== 'string' ||
              typeof item.name !== 'string' ||
              typeof item.caseId !== 'string'
            ) {
              return [];
            }
            return [
              {
                id: item.id,
                name: item.name,
                description:
                  typeof item.description === 'string'
                    ? item.description
                    : null,
                caseId: item.caseId,
                caseName:
                  typeof graphCase?.name === 'string' ? graphCase.name : '',
                lastOpenedAt:
                  typeof item.lastOpenedAt === 'string'
                    ? item.lastOpenedAt
                    : null,
                updatedAt:
                  typeof item.updatedAt === 'string' ? item.updatedAt : ''
              }
            ];
          }
        )
      );
      setFlows(
        (Array.isArray(flowJson?.flows) ? flowJson.flows : []).flatMap(
          (raw: unknown) => {
            const item = asRecord(raw);
            if (
              !item ||
              typeof item.id !== 'string' ||
              typeof item.name !== 'string'
            ) {
              return [];
            }
            return [
              {
                id: item.id,
                name: item.name,
                description:
                  typeof item.description === 'string'
                    ? item.description
                    : null,
                lastOpenedAt:
                  typeof item.lastOpenedAt === 'string'
                    ? item.lastOpenedAt
                    : null,
                updatedAt:
                  typeof item.updatedAt === 'string' ? item.updatedAt : ''
              }
            ];
          }
        )
      );

      setSelectedCaseId((current) => {
        const stored =
          typeof window !== 'undefined'
            ? window.localStorage.getItem(ACTIVE_CASE_KEY)
            : null;
        const next =
          nextCases.find((item) => item.id === current)?.id ??
          nextCases.find((item) => item.id === stored)?.id ??
          nextCases[0]?.id ??
          null;

        if (typeof window !== 'undefined') {
          if (next) window.localStorage.setItem(ACTIVE_CASE_KEY, next);
          else window.localStorage.removeItem(ACTIVE_CASE_KEY);
        }
        return next;
      });
    } catch {
      setGraphs([]);
      setCases([]);
      setFlows([]);
      toast.error('Unable to load workspace resources');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  const activeCase = useMemo(
    () => cases.find((item) => item.id === selectedCaseId) ?? null,
    [cases, selectedCaseId]
  );

  useEffect(() => {
    if (!activeCase) {
      setNotes([]);
      return;
    }

    const controller = new AbortController();
    setIsLoadingNotes(true);
    fetch(`/api/cases/${encodeURIComponent(activeCase.id)}/notes`, {
      signal: controller.signal,
      cache: 'no-store'
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('notes_load_failed');
        return response.json();
      })
      .then((data) => {
        if (controller.signal.aborted) return;
        setNotes(
          (Array.isArray(data?.notes) ? data.notes : []).flatMap(
            (raw: unknown) => {
              const item = asRecord(raw);
              if (
                !item ||
                typeof item.id !== 'string' ||
                typeof item.name !== 'string'
              ) {
                return [];
              }
              return [
                {
                  id: item.id,
                  name: item.name,
                  caseId: activeCase.id,
                  caseName: activeCase.name,
                  lastOpenedAt:
                    typeof item.lastOpenedAt === 'string'
                      ? item.lastOpenedAt
                      : null,
                  updatedAt:
                    typeof item.updatedAt === 'string' ? item.updatedAt : ''
                }
              ];
            }
          )
        );
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError')
          return;
        setNotes([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingNotes(false);
      });

    return () => controller.abort();
  }, [activeCase]);

  const normalizedQuery = useMemo(() => normalizeString(query), [query]);
  const lowerQuery = useMemo(
    () => safeLower(normalizedQuery),
    [normalizedQuery]
  );

  const matchedGraphs = useMemo(() => {
    if (!lowerQuery || !activeCase) return [];
    return graphs
      .filter(
        (graph) =>
          graph.caseId === activeCase.id &&
          (safeLower(graph.name).includes(lowerQuery) ||
            safeLower(graph.description ?? '').includes(lowerQuery))
      )
      .slice(0, 6);
  }, [activeCase, graphs, lowerQuery]);

  const matchedNotes = useMemo(() => {
    if (!lowerQuery) return [];
    return notes
      .filter((note) => safeLower(note.name).includes(lowerQuery))
      .slice(0, 5);
  }, [lowerQuery, notes]);

  const matchedFlows = useMemo(() => {
    if (!lowerQuery) return [];
    return flows
      .filter(
        (flow) =>
          safeLower(flow.name).includes(lowerQuery) ||
          safeLower(flow.description ?? '').includes(lowerQuery)
      )
      .slice(0, 5);
  }, [flows, lowerQuery]);

  const createSuggestion = useMemo(() => {
    if (!normalizedQuery) return null;
    const guessed = guessNodeTypeFromQuery(normalizedQuery);
    return guessed.label ? { ...guessed, graphName: normalizedQuery } : null;
  }, [normalizedQuery]);

  function selectWorkingCase(caseId: string) {
    if (!cases.some((item) => item.id === caseId)) return;
    setSelectedCaseId(caseId);
    window.localStorage.setItem(ACTIVE_CASE_KEY, caseId);
  }

  async function openGraph(graph: {
    id: string;
    name: string;
    caseId?: string;
  }) {
    if (graph.caseId) selectWorkingCase(graph.caseId);
    openTab({ kind: 'graph', resourceId: graph.id, title: graph.name });
    if (tabId) closeTab(tabId);
  }

  function openCase(caseItem: { id: string; name: string }) {
    selectWorkingCase(caseItem.id);
    router.push(`/cases/${caseItem.id}`);
  }

  async function openNote(note: { id: string; name: string; caseId: string }) {
    selectWorkingCase(note.caseId);
    openTab({
      kind: 'note',
      resourceId: `${note.caseId}/${note.id}`,
      title: note.name
    });
    if (tabId) closeTab(tabId);
  }

  async function openFlow(flow: { id: string; name: string }) {
    openTab({ kind: 'flow', resourceId: flow.id, title: flow.name });
    if (tabId) closeTab(tabId);
  }

  async function openRecent(item: RecentResource) {
    if (item.kind === 'case') {
      openCase(item);
      return;
    }
    if (item.kind === 'graph') {
      await openGraph(item);
      return;
    }
    if (item.kind === 'note' && item.caseId) {
      await openNote({ ...item, caseId: item.caseId });
      return;
    }
    if (item.kind === 'flow') await openFlow(item);
  }

  async function createCase() {
    const name = newCaseName.trim();
    if (!name) return;

    setIsCreatingCase(true);
    try {
      const response = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: newCaseDescription.trim()
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? 'Unable to create the case');
      }

      const created = asRecord(data?.case);
      if (
        !created ||
        typeof created.id !== 'string' ||
        typeof created.name !== 'string'
      ) {
        throw new Error('Invalid case response');
      }

      const nextCase: CaseListItem = {
        id: created.id,
        name: created.name,
        updatedAt:
          typeof created.updatedAt === 'string' ? created.updatedAt : '',
        lastOpenedAt: null
      };
      setCases((current) => [
        nextCase,
        ...current.filter((item) => item.id !== nextCase.id)
      ]);
      setSelectedCaseId(nextCase.id);
      window.localStorage.setItem(ACTIVE_CASE_KEY, nextCase.id);
      setNewCaseName('');
      setNewCaseDescription('');
      setCreateCaseOpen(false);
      toast.success('Case created');
      window.localStorage.setItem('cases-need-refresh', 'true');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Unable to create the case'
      );
    } finally {
      setIsCreatingCase(false);
    }
  }

  useEffect(() => {
    setActiveIndex(0);
  }, [normalizedQuery, selectedCaseId]);

  const selectableItems: Array<{
    key: string;
    onSelect: () => Promise<void> | void;
  }> = [
    ...matchedGraphs.map((graph) => ({
      key: `graph:${graph.id}`,
      onSelect: () => openGraph(graph)
    })),
    ...matchedNotes.map((note) => ({
      key: `note:${note.id}`,
      onSelect: () => openNote(note)
    })),
    ...matchedFlows.map((flow) => ({
      key: `flow:${flow.id}`,
      onSelect: () => openFlow(flow)
    }))
  ];

  if (createSuggestion && activeCase) {
    selectableItems.push({
      key: `create:${createSuggestion.type}:${createSuggestion.label}`,
      onSelect: () =>
        createGraphWithNode({
          graphName: createSuggestion.graphName,
          nodeType: createSuggestion.type,
          nodeLabel: createSuggestion.label
        })
    });
  }

  const filteredCases = cases.filter((item) =>
    safeLower(item.name).includes(safeLower(caseFilter.trim()))
  );
  const isResultsOpen = normalizedQuery.length > 0;
  const caseShortcuts = useMemo<RecentResource[]>(
    () =>
      sortByRecency(cases)
        .slice(0, 3)
        .map((item) => ({ kind: 'case', ...item })),
    [cases]
  );
  const graphShortcuts = useMemo<RecentResource[]>(
    () =>
      sortByRecency(
        activeCase ? graphs.filter((item) => item.caseId === activeCase.id) : []
      )
        .slice(0, 3)
        .map((item) => ({ kind: 'graph', ...item })),
    [activeCase, graphs]
  );
  const noteShortcuts = useMemo<RecentResource[]>(
    () =>
      sortByRecency(notes)
        .slice(0, 3)
        .map((item) => ({ kind: 'note', ...item })),
    [notes]
  );
  const flowShortcuts = useMemo<RecentResource[]>(
    () =>
      sortByRecency(flows)
        .slice(0, 3)
        .map((item) => ({ kind: 'flow', ...item })),
    [flows]
  );

  async function createGraphWithNode(args: {
    graphName: string;
    nodeType: NodeType;
    nodeLabel: string;
  }) {
    const name = normalizeString(args.graphName);
    if (!name) return;
    if (!activeCase) {
      toast.error('Create a Case first. Every graph must belong to a Case.');
      return;
    }

    setIsSubmitting(true);
    try {
      const createRes = await fetch('/api/graphs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: null,
          visibility: 'workspace',
          caseId: activeCase.id
        })
      });
      const created = await createRes.json().catch(() => null);
      if (!createRes.ok) {
        throw new Error(created?.error ?? 'Unable to create the graph');
      }
      const graph = created.graph as { id: string; name: string };

      const nodeId = `node-${Date.now()}`;
      const nodes = [
        {
          id: nodeId,
          type: 'osint',
          position: { x: 0, y: 0 },
          selected: true,
          data: {
            label: args.nodeLabel,
            type: args.nodeType,
            metadata: {}
          }
        }
      ];
      const edges: unknown[] = [];

      const updateRes = await fetch(`/api/graphs/${graph.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges })
      });
      if (!updateRes.ok) throw new Error('update_graph_failed');

      window.localStorage.setItem('graphs-need-refresh', 'true');
      await openGraph({
        id: graph.id,
        name: graph.name,
        caseId: activeCase.id
      });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Unable to create the graph. Try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-6xl flex-col items-center',
        className
      )}
    >
      <div className='mb-6 w-full text-center'>
        <div className='text-foreground/80 text-4xl font-semibold tracking-[0.35em] md:text-5xl'>
          PARANOD
        </div>
      </div>

      <div className='w-full max-w-4xl'>
        <div className='mb-2.5 flex items-center px-1'>
          <Popover
            open={casePickerOpen}
            onOpenChange={(open) => {
              setCasePickerOpen(open);
              if (!open) setCaseFilter('');
            }}
          >
            <PopoverTrigger asChild>
              <button
                type='button'
                className='hover:bg-accent focus-visible:ring-ring flex h-10 max-w-[min(28rem,80vw)] min-w-0 items-center gap-2.5 rounded-md px-3 text-base outline-none focus-visible:ring-1'
                aria-label='Select working case'
              >
                <IconCase className='text-muted-foreground size-[18px] shrink-0' />
                <span className='truncate font-medium'>
                  {activeCase?.name ??
                    (isLoading ? 'Loading cases…' : 'Select a case')}
                </span>
                <CaretDown className='text-muted-foreground size-4 shrink-0' />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align='start'
              className='w-[min(24rem,calc(100vw-2rem))] rounded-lg p-0'
            >
              <div className='border-border/50 flex items-center gap-2 border-b px-3'>
                <MagnifyingGlass className='text-muted-foreground size-4' />
                <Input
                  value={caseFilter}
                  onChange={(event) => setCaseFilter(event.target.value)}
                  placeholder='Find a case'
                  className='h-11 border-0 px-0 shadow-none focus-visible:ring-0'
                />
              </div>
              <div className='max-h-64 overflow-y-auto p-1.5'>
                {filteredCases.length > 0 ? (
                  filteredCases.map((caseItem) => (
                    <button
                      key={caseItem.id}
                      type='button'
                      onClick={() => {
                        selectWorkingCase(caseItem.id);
                        setCasePickerOpen(false);
                      }}
                      className='hover:bg-accent flex h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm'
                    >
                      <IconCase className='text-muted-foreground size-4 shrink-0' />
                      <span className='min-w-0 flex-1 truncate'>
                        {caseItem.name}
                      </span>
                      {caseItem.id === selectedCaseId ? (
                        <Check className='text-primary size-4 shrink-0' />
                      ) : null}
                    </button>
                  ))
                ) : (
                  <div className='text-muted-foreground px-3 py-5 text-center text-xs'>
                    {cases.length === 0 ? 'No cases yet' : 'No matching cases'}
                  </div>
                )}
              </div>
              <div className='border-border/50 border-t p-1.5'>
                <button
                  type='button'
                  onClick={() => {
                    setCasePickerOpen(false);
                    setCreateCaseOpen(true);
                  }}
                  className='hover:bg-accent flex h-10 w-full items-center gap-2 rounded-md px-2 text-left text-sm font-medium'
                >
                  <Plus className='size-4' />
                  New case
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        <div
          className={cn(
            'relative z-20 mx-auto w-full',
            'border-border/50 bg-background/80 rounded-lg border shadow-sm backdrop-blur-md',
            'focus-within:border-border/60 focus-within:ring-ring/15 transition-[box-shadow,border-color] focus-within:ring-1'
          )}
        >
          <div className='relative flex items-center gap-2.5 px-3 py-1'>
            <div className='text-muted-foreground pointer-events-none'>
              <MagnifyingGlass className='size-[18px]' />
            </div>
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                activeCase
                  ? `Search ${activeCase.name} or paste an entity`
                  : 'Select or create a case to start'
              }
              className={cn(
                'h-10 flex-1 rounded-md border-0 bg-transparent px-1.5 text-base shadow-none md:text-base',
                'focus-visible:border-0 focus-visible:ring-0'
              )}
              disabled={!activeCase}
              autoFocus
              onKeyDown={(e) => {
                const count = selectableItems.length;
                if (e.key === 'Tab') {
                  if (count === 0) return;
                  e.preventDefault();
                  setActiveIndex((prev) => {
                    const dir = e.shiftKey ? -1 : 1;
                    return (prev + dir + count) % count;
                  });
                  return;
                }
                if (e.key === 'ArrowDown') {
                  if (count === 0) return;
                  e.preventDefault();
                  setActiveIndex((prev) => (prev + 1) % count);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  if (count === 0) return;
                  e.preventDefault();
                  setActiveIndex((prev) => (prev - 1 + count) % count);
                  return;
                }
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const active = selectableItems[activeIndex];
                if (active) void active.onSelect();
              }}
            />
            <Button
              type='button'
              size='icon'
              className='h-9 w-9 rounded-md'
              disabled={isSubmitting || !createSuggestion || !activeCase}
              onClick={() => {
                if (!createSuggestion) return;
                void createGraphWithNode({
                  graphName: createSuggestion.graphName,
                  nodeType: createSuggestion.type,
                  nodeLabel: createSuggestion.label
                });
              }}
              aria-label='Create graph'
              title='Create graph'
            >
              <IconChevronRight className='size-4' />
            </Button>
          </div>

          <AnimatePresence initial={false}>
            {isResultsOpen && (
              <motion.div
                key='results'
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className='border-border/50 bg-popover absolute inset-x-0 top-full z-50 mt-1 rounded-lg border shadow-xl'
              >
                <div
                  className={cn(
                    'max-h-80 overflow-y-auto px-2 py-2 pr-1',
                    '[scrollbar-gutter:stable] [&::-webkit-scrollbar]:w-1.5',
                    '[&::-webkit-scrollbar-track]:bg-transparent',
                    '[&::-webkit-scrollbar-thumb]:bg-border/50 [&::-webkit-scrollbar-thumb]:rounded-full',
                    'hover:[&::-webkit-scrollbar-thumb]:bg-border/70'
                  )}
                >
                  {normalizedQuery ? (
                    <div className='space-y-2'>
                      {matchedGraphs.length > 0 && (
                        <div>
                          <div className='text-muted-foreground px-2 py-1 text-[10px] font-semibold uppercase'>
                            Graphs
                          </div>
                          <div className='space-y-1'>
                            {matchedGraphs.map((g) => {
                              const key = `graph:${g.id}`;
                              const selIndex = selectableItems.findIndex(
                                (i) => i.key === key
                              );
                              const isActive = selIndex === activeIndex;
                              return (
                                <motion.button
                                  layout
                                  key={g.id}
                                  type='button'
                                  onMouseEnter={() =>
                                    selIndex >= 0 && setActiveIndex(selIndex)
                                  }
                                  onClick={() => void openGraph(g)}
                                  className={cn(
                                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                                    isActive ? 'bg-accent' : 'hover:bg-accent'
                                  )}
                                >
                                  <IconGraph className='text-muted-foreground h-4 w-4' />
                                  <div className='min-w-0 flex-1'>
                                    <div className='truncate text-sm font-medium'>
                                      {g.name}
                                    </div>
                                    {g.description ? (
                                      <div className='text-muted-foreground line-clamp-1 text-xs'>
                                        {g.description}
                                      </div>
                                    ) : null}
                                  </div>
                                </motion.button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {matchedNotes.length > 0 && (
                        <div>
                          <div className='text-muted-foreground px-2 py-1 text-[10px] font-semibold uppercase'>
                            Notes in {activeCase?.name}
                          </div>
                          <div className='space-y-1'>
                            {matchedNotes.map((note) => {
                              const key = `note:${note.id}`;
                              const selIndex = selectableItems.findIndex(
                                (i) => i.key === key
                              );
                              const isActive = selIndex === activeIndex;
                              return (
                                <motion.button
                                  layout
                                  key={note.id}
                                  type='button'
                                  onMouseEnter={() =>
                                    selIndex >= 0 && setActiveIndex(selIndex)
                                  }
                                  onClick={() => void openNote(note)}
                                  className={cn(
                                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                                    isActive ? 'bg-accent' : 'hover:bg-accent'
                                  )}
                                >
                                  <NoteIcon className='text-muted-foreground h-4 w-4' />
                                  <div className='min-w-0 flex-1'>
                                    <div className='truncate text-sm font-medium'>
                                      {note.name}
                                    </div>
                                  </div>
                                </motion.button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {matchedFlows.length > 0 && (
                        <div>
                          <div className='text-muted-foreground px-2 py-1 text-[10px] font-semibold uppercase'>
                            Flows
                          </div>
                          <div className='space-y-1'>
                            {matchedFlows.map((flow) => {
                              const key = `flow:${flow.id}`;
                              const selIndex = selectableItems.findIndex(
                                (item) => item.key === key
                              );
                              const isActive = selIndex === activeIndex;
                              return (
                                <motion.button
                                  layout
                                  key={flow.id}
                                  type='button'
                                  onMouseEnter={() =>
                                    selIndex >= 0 && setActiveIndex(selIndex)
                                  }
                                  onClick={() => void openFlow(flow)}
                                  className={cn(
                                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                                    isActive ? 'bg-accent' : 'hover:bg-accent'
                                  )}
                                >
                                  <FlowIcon className='text-muted-foreground h-4 w-4 -rotate-90' />
                                  <div className='min-w-0 flex-1'>
                                    <div className='truncate text-sm font-medium'>
                                      {flow.name}
                                    </div>
                                    {flow.description ? (
                                      <div className='text-muted-foreground line-clamp-1 text-xs'>
                                        {flow.description}
                                      </div>
                                    ) : null}
                                  </div>
                                </motion.button>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {createSuggestion && (
                        <div>
                          <div className='text-muted-foreground px-2 py-1 text-[10px] font-semibold uppercase'>
                            Create
                          </div>
                          {(() => {
                            const key = `create:${createSuggestion.type}:${createSuggestion.label}`;
                            const selIndex = selectableItems.findIndex(
                              (i) => i.key === key
                            );
                            const isActive = selIndex === activeIndex;
                            return (
                              <motion.button
                                layout
                                type='button'
                                disabled={isSubmitting}
                                onMouseEnter={() =>
                                  selIndex >= 0 && setActiveIndex(selIndex)
                                }
                                onClick={() =>
                                  void createGraphWithNode({
                                    graphName: createSuggestion.graphName,
                                    nodeType: createSuggestion.type,
                                    nodeLabel: createSuggestion.label
                                  })
                                }
                                className={cn(
                                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                                  isActive ? 'bg-accent' : 'hover:bg-accent'
                                )}
                              >
                                <Sparkle className='text-primary h-4 w-4' />
                                <div className='min-w-0 flex-1'>
                                  <div className='truncate text-sm font-medium'>
                                    Create Graph “{createSuggestion.graphName}”
                                  </div>
                                  <div className='text-muted-foreground text-xs'>
                                    Starting node: {createSuggestion.hint} →{' '}
                                    {createSuggestion.label}
                                  </div>
                                </div>
                                <IconChevronRight className='text-muted-foreground h-4 w-4' />
                              </motion.button>
                            );
                          })()}
                        </div>
                      )}

                      {matchedGraphs.length === 0 &&
                        matchedNotes.length === 0 &&
                        matchedFlows.length === 0 &&
                        !createSuggestion && (
                          <div className='text-muted-foreground px-3 py-6 text-center text-sm'>
                            No results.
                          </div>
                        )}
                    </div>
                  ) : null}

                  {(isLoading || isLoadingNotes) && (
                    <div className='text-muted-foreground px-3 py-2 text-xs'>
                      Loading…
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className='mt-10 grid w-full grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4'>
        <RecentWidget
          title='Cases'
          kind='case'
          items={caseShortcuts}
          onOpen={(item) => void openRecent(item)}
          onTitleClick={() => router.push('/cases')}
          emptyLabel='No cases available'
        />
        <RecentWidget
          title='Graphs'
          kind='graph'
          items={graphShortcuts}
          onOpen={(item) => void openRecent(item)}
          onTitleClick={() =>
            router.push(activeCase ? `/cases/${activeCase.id}` : '/graphs')
          }
          emptyLabel='No graphs in this case'
        />
        <RecentWidget
          title='Notes'
          kind='note'
          items={noteShortcuts}
          onOpen={(item) => void openRecent(item)}
          onTitleClick={() =>
            router.push(activeCase ? `/cases/${activeCase.id}` : '/cases')
          }
          emptyLabel='No notes in this case'
        />
        <RecentWidget
          title='Flows'
          kind='flow'
          items={flowShortcuts}
          onOpen={(item) => void openRecent(item)}
          onTitleClick={() => router.push('/flows')}
          emptyLabel='No flows available'
        />
      </div>

      <Dialog
        open={createCaseOpen}
        onOpenChange={(open) => {
          setCreateCaseOpen(open);
          if (!open && !isCreatingCase) {
            setNewCaseName('');
            setNewCaseDescription('');
          }
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void createCase();
            }}
          >
            <DialogHeader>
              <DialogTitle>New case</DialogTitle>
              <DialogDescription>
                Graphs, notes, and investigation context will stay grouped in
                this case.
              </DialogDescription>
            </DialogHeader>
            <div className='space-y-4 py-5'>
              <div className='space-y-2'>
                <Label htmlFor='new-case-name'>Name</Label>
                <Input
                  id='new-case-name'
                  value={newCaseName}
                  onChange={(event) => setNewCaseName(event.target.value)}
                  placeholder='Investigation name'
                  autoFocus
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='new-case-description'>
                  Description{' '}
                  <span className='text-muted-foreground'>(optional)</span>
                </Label>
                <Textarea
                  id='new-case-description'
                  value={newCaseDescription}
                  onChange={(event) =>
                    setNewCaseDescription(event.target.value)
                  }
                  placeholder='Context or working hypothesis'
                  className='min-h-24 resize-none'
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => setCreateCaseOpen(false)}
                disabled={isCreatingCase}
              >
                Cancel
              </Button>
              <Button
                type='submit'
                disabled={isCreatingCase || !newCaseName.trim()}
              >
                {isCreatingCase ? 'Creating…' : 'Create case'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
