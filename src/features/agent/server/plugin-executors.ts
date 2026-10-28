import type { PluginExecutor } from '@/features/plugins/types';
import { dnsPluginExecutor } from '@/features/plugins/builtin/dns-plugin';
import { emailPluginExecutor } from '@/features/plugins/builtin/email-plugin';
import { ipPluginExecutor } from '@/features/plugins/builtin/ip-plugin';
import { urlPluginExecutor } from '@/features/plugins/builtin/url-plugin';
import { whoisPluginExecutor } from '@/features/plugins/builtin/whois-plugin';
import { subdomainPluginExecutor } from '@/features/plugins/builtin/subdomain-plugin';
import {
  blockchainComPluginExecutor,
  blockcypherPluginExecutor
} from '@/features/plugins/builtin/blockchain-plugin';
import { disposableEmailPluginExecutor } from '@/features/plugins/builtin/disposable-email-plugin';
import {
  extractPlatformInfo,
  generateSearchLinks
} from '@/features/plugins/builtin/social-plugin';
import { whatsMyNamePluginExecutor } from '@/features/plugins/builtin/whatsmyname-plugin';
import { hibpPluginExecutor } from '@/features/plugins/builtin/hibp-plugin';
import { osintIndustriesPluginExecutor } from '@/features/plugins/builtin/osint-industries-plugin';
import { etherscanPluginExecutor } from '@/features/plugins/builtin/etherscan-plugin';
import { whoisHistoryPluginExecutor } from '@/features/plugins/builtin/whois-history-plugin';
import { hudsonRockPluginExecutor } from '@/features/plugins/builtin/hudsonrock-plugin';
import { breachVipPluginExecutor } from '@/features/plugins/builtin/breach-vip-plugin';
import { emailRepPluginExecutor } from '@/features/plugins/builtin/emailrep-plugin';
import { breachDirectoryPluginExecutor } from '@/features/plugins/builtin/breachdirectory-plugin';
import { emailHeadersPluginExecutor } from '@/features/plugins/builtin/email-headers-plugin';
import { hashEvidencePluginExecutor } from '@/features/plugins/builtin/hash-evidence-plugin';
import { locationPluginExecutor } from '@/features/plugins/builtin/location-plugin';
import { notePluginExecutor } from '@/features/plugins/builtin/note-plugin';
import { videoPluginExecutor } from '@/features/plugins/builtin/video-plugin';
import { imagePluginExecutor } from '@/features/plugins/builtin/image-plugin';

const socialPluginExecutor: PluginExecutor = {
  execute(transformId, input) {
    return transformId === 'social-extract-info'
      ? Promise.resolve(extractPlatformInfo(input))
      : Promise.resolve(generateSearchLinks(input));
  }
};

const EXECUTORS: Record<string, PluginExecutor> = {
  'dns-lookup': dnsPluginExecutor,
  'email-parser': emailPluginExecutor,
  'ip-geolocation': ipPluginExecutor,
  'url-parser': urlPluginExecutor,
  'whois-lookup': whoisPluginExecutor,
  'subdomain-finder': subdomainPluginExecutor,
  blockchain: blockchainComPluginExecutor,
  blockcypher: blockcypherPluginExecutor,
  'disposable-email': disposableEmailPluginExecutor,
  'social-media': socialPluginExecutor,
  whatsmyname: whatsMyNamePluginExecutor,
  hibp: hibpPluginExecutor,
  'osint-industries': osintIndustriesPluginExecutor,
  etherscan: etherscanPluginExecutor,
  'whois-history': whoisHistoryPluginExecutor,
  hudsonrock: hudsonRockPluginExecutor,
  'breach-vip': breachVipPluginExecutor,
  emailrep: emailRepPluginExecutor,
  breachdirectory: breachDirectoryPluginExecutor,
  'email-headers': emailHeadersPluginExecutor,
  'hash-evidence': hashEvidencePluginExecutor,
  'location-intelligence': locationPluginExecutor,
  'note-analysis': notePluginExecutor,
  'video-analysis': videoPluginExecutor,
  'image-analysis': imagePluginExecutor
};

export function agentPluginExecutor(pluginId: string) {
  return EXECUTORS[pluginId] ?? null;
}
