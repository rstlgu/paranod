/**
 * Etherscan Plugin (Ethereum / EVM) — richiede API key.
 *
 *
 * Etherscan API v2 (multichain, chainid=1 = Ethereum mainnet):
 *   GET https://api.etherscan.io/v2/api?chainid=1&module=account&action=...&address=...&apikey=...
 *   action=balance     → saldo in wei
 *   action=txlist      → transazioni normali
 *   action=tokennfttx  → trasferimenti NFT (ERC-721)
 */

import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor
} from '../types';
import { osintEntity, osintEdge, osintFail } from './osint-utils';

const SOURCE = 'etherscan';
const API = 'https://api.etherscan.io/v2/api';
const CHAIN_ID = 1;
const MAX_TX = 40;
const MAX_NFT = 40;

function getApiKey(input: TransformInput): string | undefined {
  const key = input.config?.apiKey;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

function isEthAddress(v: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(v.trim());
}

async function etherscanGet(
  params: Record<string, string>,
  apiKey: string
): Promise<{ status: string; message: string; result: unknown } | null> {
  const qs = new URLSearchParams({
    chainid: String(CHAIN_ID),
    ...params,
    apikey: apiKey
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`${API}?${qs.toString()}`, {
      headers: { 'User-Agent': 'PARANOD-OSINT/1.0', Accept: 'application/json' },
      signal: controller.signal
    });
    if (!res.ok) return null;
    return (await res.json().catch(() => null)) as {
      status: string;
      message: string;
      result: unknown;
    } | null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** wei (string) → ETH con 6 decimali. */
function weiToEth(wei: string): string {
  try {
    const WEI_PER_ETH = BigInt('1000000000000000000');
    const WEI_PER_MICRO = BigInt('1000000000000'); // 1e12 → 6 decimali
    const v = BigInt(wei);
    const whole = v / WEI_PER_ETH;
    const frac = (v % WEI_PER_ETH) / WEI_PER_MICRO;
    return `${whole}.${frac.toString().padStart(6, '0')}`;
  } catch {
    return '0';
  }
}

async function walletBalance(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const address = input.entity.value.trim();
  if (!isEthAddress(address)) return osintFail('Not a valid Ethereum address', startTime);
  const apiKey = getApiKey(input);
  if (!apiKey) return osintFail('Etherscan API key not configured', startTime);

  const data = await etherscanGet(
    { module: 'account', action: 'balance', address, tag: 'latest' },
    apiKey
  );
  if (!data) return osintFail('Etherscan request failed', startTime);
  if (data.status !== '1' && typeof data.result === 'string' && /Invalid API Key/i.test(data.result))
    return osintFail('Etherscan: invalid API key', startTime);

  const wei = typeof data.result === 'string' ? data.result : '0';
  const eth = weiToEth(wei);

  const entity = osintEntity(
    SOURCE,
    'note',
    `${eth} ETH`,
    `Balance: ${eth} ETH`,
    { provider: 'etherscan', address, wei, eth, chain: 'ethereum' },
    true
  );
  return {
    success: true,
    entities: [entity],
    edges: [osintEdge(input.entity.id, entity.id, 'Balance', 'has_balance')],
    message: `Balance: ${eth} ETH`,
    executionTime: Date.now() - startTime
  };
}

async function walletTransactions(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const address = input.entity.value.trim().toLowerCase();
  if (!isEthAddress(address)) return osintFail('Not a valid Ethereum address', startTime);
  const apiKey = getApiKey(input);
  if (!apiKey) return osintFail('Etherscan API key not configured', startTime);

  const data = await etherscanGet(
    {
      module: 'account',
      action: 'txlist',
      address,
      startblock: '0',
      endblock: '99999999',
      page: '1',
      offset: String(MAX_TX),
      sort: 'desc'
    },
    apiKey
  );
  if (!data) return osintFail('Etherscan request failed', startTime);
  const txs = Array.isArray(data.result) ? (data.result as any[]) : [];
  if (txs.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No transactions found.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const seenCounterparties = new Set<string>();

  for (const tx of txs.slice(0, MAX_TX)) {
    const hash = String(tx.hash ?? '');
    const from = String(tx.from ?? '').toLowerCase();
    const to = String(tx.to ?? '').toLowerCase();
    const eth = weiToEth(String(tx.value ?? '0'));
    const outgoing = from === address;
    const counterparty = outgoing ? to : from;

    const txEntity = osintEntity(
      SOURCE,
      'transaction',
      hash,
      `${eth} ETH ${outgoing ? '→' : '←'}`,
      {
        provider: 'etherscan',
        hash,
        from,
        to,
        valueEth: eth,
        timeStamp: tx.timeStamp,
        blockNumber: tx.blockNumber,
        direction: outgoing ? 'out' : 'in'
      }
    );
    entities.push(txEntity);
    edges.push(
      osintEdge(
        input.entity.id,
        txEntity.id,
        outgoing ? 'Sent' : 'Received',
        outgoing ? 'sent' : 'received'
      )
    );

    if (counterparty && isEthAddress(counterparty) && !seenCounterparties.has(counterparty)) {
      seenCounterparties.add(counterparty);
      const cp = osintEntity(SOURCE, 'wallet_eth', counterparty, counterparty, {
        provider: 'etherscan'
      });
      entities.push(cp);
      edges.push(osintEdge(txEntity.id, cp.id, 'Counterparty', 'transacted_with'));
    }
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${txs.length} transaction(s).`,
    executionTime: Date.now() - startTime
  };
}

async function walletNfts(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const address = input.entity.value.trim().toLowerCase();
  if (!isEthAddress(address)) return osintFail('Not a valid Ethereum address', startTime);
  const apiKey = getApiKey(input);
  if (!apiKey) return osintFail('Etherscan API key not configured', startTime);

  const data = await etherscanGet(
    {
      module: 'account',
      action: 'tokennfttx',
      address,
      page: '1',
      offset: String(MAX_NFT * 2),
      sort: 'desc'
    },
    apiKey
  );
  if (!data) return osintFail('Etherscan request failed', startTime);
  const transfers = Array.isArray(data.result) ? (data.result as any[]) : [];
  if (transfers.length === 0) {
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No NFT transfers found.',
      executionTime: Date.now() - startTime
    };
  }

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];
  const seen = new Set<string>();

  for (const t of transfers) {
    const contract = String(t.contractAddress ?? '').toLowerCase();
    const tokenId = String(t.tokenID ?? '');
    if (!contract || !tokenId) continue;
    const key = `${contract}:${tokenId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = t.tokenName || 'NFT';
    const symbol = t.tokenSymbol ? ` (${t.tokenSymbol})` : '';
    const nft = osintEntity(
      SOURCE,
      'custom',
      key,
      `${name}${symbol} #${tokenId}`,
      {
        provider: 'etherscan',
        kind: 'nft',
        contract,
        tokenId,
        collection: t.tokenName,
        symbol: t.tokenSymbol
      }
    );
    entities.push(nft);
    edges.push(osintEdge(input.entity.id, nft.id, 'Holds NFT', 'associated_with'));
    if (entities.length >= MAX_NFT) break;
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${entities.length} NFT(s).`,
    executionTime: Date.now() - startTime
  };
}

export const etherscanPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'eth-balance':
        return walletBalance(input);
      case 'eth-transactions':
        return walletTransactions(input);
      case 'eth-nfts':
        return walletNfts(input);
      default:
        return {
          success: false,
          entities: [],
          edges: [],
          error: `Unknown transform: ${transformId}`
        };
    }
  }
};

export default etherscanPluginExecutor;
