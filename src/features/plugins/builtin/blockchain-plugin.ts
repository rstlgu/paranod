/**
 * Blockchain Plugin
 * Uses Blockchain.com API for Bitcoin wallet analysis
 */

import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  PluginExecutor
} from '../types';

// Genera ID unici
function generateId(): string {
  return `entity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Tipi per Blockchain.com API
interface BlockchainAddressInfo {
  address: string;
  final_balance: number;
  total_received: number;
  total_sent: number;
  n_tx: number;
}

interface BlockchainTransaction {
  hash: string;
  time: number;
  fee: number;
  result: number;
  balance: number;
  inputs: Array<{
    prev_out?: {
      addr?: string;
      value: number;
    };
  }>;
  out: Array<{
    addr?: string;
    value: number;
  }>;
}

// Tipi per BlockCypher (ETH)
interface BlockCypherEthAddressInfo {
  address: string;
  balance: number; // wei
  final_balance: number; // wei
  total_received: number; // wei
  total_sent: number; // wei
  n_tx: number;
  txrefs?: Array<{
    tx_hash: string;
    confirmed?: string;
    confirmed_at?: string;
    block_height?: number;
    tx_input_n?: number;
    tx_output_n?: number;
    value?: number; // wei
  }>;
}

interface BlockCypherTx {
  hash: string;
  confirmed?: string;
  received?: string;
  confirmations?: number;
  fees?: number; // satoshi for BTC, wei for ETH (per docs vary)
  inputs?: Array<{ addresses?: string[]; output_value?: number }>;
  outputs?: Array<{ addresses?: string[]; value?: number }>;
}

// Converti satoshi in BTC
function satoshiToBTC(satoshi: number): string {
  return (satoshi / 100000000).toFixed(8);
}

function weiToEth(wei: number): string {
  return (wei / 1e18).toFixed(6);
}

// Formatta timestamp
function formatTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString('it-IT');
}

function isBtcWalletAddress(value: string) {
  // base58 o bech32
  return /^(1|3|bc1)[a-zA-HJ-NP-Z0-9]{25,62}$/i.test(value);
}

function isEthWalletAddress(value: string) {
  return /^0x[0-9a-f]{40}$/i.test(value);
}

function isBtcTxHash(value: string) {
  return /^[a-fA-F0-9]{64}$/.test(value);
}

function isEthTxHash(value: string) {
  return /^0x[0-9a-f]{64}$/i.test(value);
}

function normalizeEthHash(value: string) {
  return value.trim().toLowerCase().replace(/^0x/, '');
}

function normalizeEthAddress(value: string) {
  return value.trim();
}

function formatTxShort(hash: string) {
  return `${hash.slice(0, 8)}...${hash.slice(-8)}`;
}

/**
 * Get wallet balance and info
 */
async function getBtcWalletBalance(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const address = input.entity.value.trim();
  const sourceId = input.entity.id;

  // Valida indirizzo Bitcoin (base58 o bech32)
  if (!isBtcWalletAddress(address)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid Bitcoin address format',
      executionTime: Date.now() - startTime
    };
  }

  try {
    const response = await fetch(
      `https://blockchain.info/rawaddr/${address}?limit=0`,
      { next: { revalidate: 60 } }
    );

    if (!response.ok) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: `Blockchain.com API error: ${response.status}`,
        executionTime: Date.now() - startTime
      };
    }

    const data: BlockchainAddressInfo = await response.json();
    const entities: OSINTEntity[] = [];
    const edges: OSINTEdge[] = [];

    // Crea nodo Note con info saldo
    const balanceInfo = `💰 Balance: ${satoshiToBTC(data.final_balance)} BTC
📥 Received: ${satoshiToBTC(data.total_received)} BTC
📤 Sent: ${satoshiToBTC(data.total_sent)} BTC
🔢 Transactions: ${data.n_tx}`;

    const infoEntity: OSINTEntity = {
      id: generateId(),
      type: 'note',
      value: `Balance: ${satoshiToBTC(data.final_balance)} BTC`,
      label: balanceInfo,
      metadata: {
        address: data.address,
        balance_satoshi: data.final_balance,
        balance_btc: satoshiToBTC(data.final_balance),
        total_received_btc: satoshiToBTC(data.total_received),
        total_sent_btc: satoshiToBTC(data.total_sent),
        transaction_count: data.n_tx
      },
      source: 'blockchain-balance',
      verified: true,
      timestamp: new Date().toISOString()
    };
    entities.push(infoEntity);
    edges.push({
      id: generateEdgeId(),
      sourceId,
      targetId: infoEntity.id,
      label: 'Balance Info',
      relationship: 'has_balance'
    });

    return {
      success: true,
      entities,
      edges,
      message: `Wallet balance: ${satoshiToBTC(data.final_balance)} BTC`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error:
        error instanceof Error ? error.message : 'Failed to fetch wallet info',
      executionTime: Date.now() - startTime
    };
  }
}

async function getEthWalletBalance(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const address = normalizeEthAddress(input.entity.value);
  const sourceId = input.entity.id;

  if (!isEthWalletAddress(address)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid Ethereum address format',
      executionTime: Date.now() - startTime
    };
  }

  try {
    const response = await fetch(
      `https://api.blockcypher.com/v1/eth/main/addrs/${address}/balance`,
      { next: { revalidate: 60 } }
    );

    if (!response.ok) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: `BlockCypher API error: ${response.status}`,
        executionTime: Date.now() - startTime
      };
    }

    const data: BlockCypherEthAddressInfo = await response.json();
    const entities: OSINTEntity[] = [];
    const edges: OSINTEdge[] = [];

    const balanceInfo = `💰 Balance: ${weiToEth(data.final_balance)} ETH
📥 Received: ${weiToEth(data.total_received)} ETH
📤 Sent: ${weiToEth(data.total_sent)} ETH
🔢 Transactions: ${data.n_tx}`;

    const infoEntity: OSINTEntity = {
      id: generateId(),
      type: 'note',
      value: `Balance: ${weiToEth(data.final_balance)} ETH`,
      label: balanceInfo,
      metadata: {
        address: data.address,
        balance_wei: data.final_balance,
        balance_eth: weiToEth(data.final_balance),
        total_received_eth: weiToEth(data.total_received),
        total_sent_eth: weiToEth(data.total_sent),
        transaction_count: data.n_tx,
        chain: 'ethereum'
      },
      source: 'eth-balance',
      verified: true,
      timestamp: new Date().toISOString()
    };
    entities.push(infoEntity);
    edges.push({
      id: generateEdgeId(),
      sourceId,
      targetId: infoEntity.id,
      label: 'Balance Info',
      relationship: 'has_balance'
    });

    return {
      success: true,
      entities,
      edges,
      message: `Wallet balance: ${weiToEth(data.final_balance)} ETH`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error:
        error instanceof Error ? error.message : 'Failed to fetch wallet info',
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Get recent transactions
 */
async function getBtcTransactions(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const address = input.entity.value.trim();
  const sourceId = input.entity.id;

  // Valida indirizzo Bitcoin
  if (!isBtcWalletAddress(address)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid Bitcoin address format',
      executionTime: Date.now() - startTime
    };
  }

  try {
    const response = await fetch(
      `https://blockchain.info/rawaddr/${address}?limit=10`,
      { next: { revalidate: 60 } }
    );

    if (!response.ok) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: `Blockchain.com API error: ${response.status}`,
        executionTime: Date.now() - startTime
      };
    }

    const data = await response.json();
    const transactions: BlockchainTransaction[] = data.txs || [];
    const entities: OSINTEntity[] = [];
    const edges: OSINTEdge[] = [];

    for (const tx of transactions.slice(0, 10)) {
      const isIncoming = tx.result > 0;
      const amount = Math.abs(tx.result);
      const shortHash = formatTxShort(tx.hash);

      const txEntity: OSINTEntity = {
        id: generateId(),
        type: 'transaction',
        value: tx.hash,
        label: `${isIncoming ? '📥' : '📤'} ${satoshiToBTC(amount)} BTC\n${shortHash}\n${formatTimestamp(tx.time)}`,
        metadata: {
          hash: tx.hash,
          time: tx.time,
          formatted_time: formatTimestamp(tx.time),
          fee_btc: satoshiToBTC(tx.fee),
          amount_btc: satoshiToBTC(amount),
          direction: isIncoming ? 'incoming' : 'outgoing',
          balance_after: satoshiToBTC(tx.balance)
        },
        source: 'blockchain-transactions',
        verified: true,
        timestamp: new Date().toISOString()
      };
      entities.push(txEntity);
      edges.push({
        id: generateEdgeId(),
        sourceId,
        targetId: txEntity.id,
        label: isIncoming ? 'Received' : 'Sent',
        relationship: isIncoming ? 'received' : 'sent'
      });
    }

    return {
      success: true,
      entities,
      edges,
      message: `Found ${entities.length} recent transactions`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error:
        error instanceof Error ? error.message : 'Failed to fetch transactions',
      executionTime: Date.now() - startTime
    };
  }
}

async function getEthTransactions(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const address = normalizeEthAddress(input.entity.value);
  const sourceId = input.entity.id;

  if (!isEthWalletAddress(address)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid Ethereum address format',
      executionTime: Date.now() - startTime
    };
  }

  try {
    const response = await fetch(
      `https://api.blockcypher.com/v1/eth/main/addrs/${address}?limit=10`,
      { next: { revalidate: 60 } }
    );

    if (!response.ok) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: `BlockCypher API error: ${response.status}`,
        executionTime: Date.now() - startTime
      };
    }

    const data: BlockCypherEthAddressInfo = await response.json();
    const refs = Array.isArray(data.txrefs) ? data.txrefs : [];

    const entities: OSINTEntity[] = [];
    const edges: OSINTEdge[] = [];

    for (const ref of refs.slice(0, 10)) {
      const txHash = ref.tx_hash;
      if (!txHash) continue;
      const with0x = txHash.startsWith('0x') ? txHash : `0x${txHash}`;
      const short = formatTxShort(with0x);
      const valueWei = typeof ref.value === 'number' ? ref.value : 0;
      const isIncoming = (ref.tx_output_n ?? -1) >= 0;
      const label = `${isIncoming ? '📥' : '📤'} ${weiToEth(Math.abs(valueWei))} ETH\n${short}`;

      const txEntity: OSINTEntity = {
        id: generateId(),
        type: 'transaction',
        value: with0x,
        label,
        metadata: {
          hash: with0x,
          tx_hash: txHash,
          amount_eth: weiToEth(Math.abs(valueWei)),
          direction: isIncoming ? 'incoming' : 'outgoing',
          chain: 'ethereum'
        },
        source: 'eth-transactions',
        verified: true,
        timestamp: new Date().toISOString()
      };
      entities.push(txEntity);
      edges.push({
        id: generateEdgeId(),
        sourceId,
        targetId: txEntity.id,
        label: isIncoming ? 'Received' : 'Sent',
        relationship: isIncoming ? 'received' : 'sent'
      });
    }

    return {
      success: true,
      entities,
      edges,
      message: `Found ${entities.length} recent transactions`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error:
        error instanceof Error ? error.message : 'Failed to fetch transactions',
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Get connected wallets (addresses that transacted with this wallet)
 */
async function getBtcConnectedWallets(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const address = input.entity.value.trim();
  const sourceId = input.entity.id;

  if (!isBtcWalletAddress(address)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid Bitcoin address format',
      executionTime: Date.now() - startTime
    };
  }

  try {
    const response = await fetch(
      `https://blockchain.info/rawaddr/${address}?limit=20`,
      { next: { revalidate: 60 } }
    );

    if (!response.ok) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: `Blockchain.com API error: ${response.status}`,
        executionTime: Date.now() - startTime
      };
    }

    const data = await response.json();
    const transactions: BlockchainTransaction[] = data.txs || [];
    const connectedAddresses = new Map<
      string,
      { count: number; direction: 'sent' | 'received' | 'both' }
    >();

    // Estrai indirizzi collegati
    for (const tx of transactions) {
      // Indirizzi di input (chi ha mandato)
      for (const inp of tx.inputs) {
        const addr = inp.prev_out?.addr;
        if (addr && addr !== address) {
          const existing = connectedAddresses.get(addr);
          if (existing) {
            existing.count++;
            if (existing.direction !== 'received') existing.direction = 'both';
          } else {
            connectedAddresses.set(addr, { count: 1, direction: 'received' });
          }
        }
      }
      // Indirizzi di output (chi ha ricevuto)
      for (const out of tx.out) {
        if (out.addr && out.addr !== address) {
          const existing = connectedAddresses.get(out.addr);
          if (existing) {
            existing.count++;
            if (existing.direction !== 'sent') existing.direction = 'both';
          } else {
            connectedAddresses.set(out.addr, { count: 1, direction: 'sent' });
          }
        }
      }
    }

    const entities: OSINTEntity[] = [];
    const edges: OSINTEdge[] = [];

    // Limita a 20 wallet collegati
    const sortedAddresses = Array.from(connectedAddresses.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 20);

    for (const [addr, info] of sortedAddresses) {
      const walletEntity: OSINTEntity = {
        id: generateId(),
        type: 'wallet_btc',
        value: addr,
        label: `${addr.slice(0, 8)}...${addr.slice(-6)}`,
        metadata: {
          address: addr,
          transaction_count: info.count,
          direction: info.direction
        },
        source: 'blockchain-connected',
        verified: true,
        timestamp: new Date().toISOString()
      };
      entities.push(walletEntity);

      const label =
        info.direction === 'both'
          ? 'Exchanged'
          : info.direction === 'sent'
            ? 'Sent to'
            : 'Received from';
      edges.push({
        id: generateEdgeId(),
        sourceId,
        targetId: walletEntity.id,
        label: `${label} (${info.count}x)`,
        relationship: 'transacted_with'
      });
    }

    return {
      success: true,
      entities,
      edges,
      message: `Found ${entities.length} connected wallets`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error:
        error instanceof Error
          ? error.message
          : 'Failed to fetch connected wallets',
      executionTime: Date.now() - startTime
    };
  }
}

async function getEthConnectedWallets(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const address = normalizeEthAddress(input.entity.value);
  const sourceId = input.entity.id;

  if (!isEthWalletAddress(address)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid Ethereum address format',
      executionTime: Date.now() - startTime
    };
  }

  try {
    const response = await fetch(
      `https://api.blockcypher.com/v1/eth/main/addrs/${address}?limit=10`,
      { next: { revalidate: 60 } }
    );
    if (!response.ok) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: `BlockCypher API error: ${response.status}`,
        executionTime: Date.now() - startTime
      };
    }

    const data: BlockCypherEthAddressInfo = await response.json();
    const refs = Array.isArray(data.txrefs) ? data.txrefs : [];
    const txHashes = refs.map((r) => r.tx_hash).filter(Boolean).slice(0, 10);

    const counterpartyCounts = new Map<string, number>();

    for (const hash of txHashes) {
      const h = normalizeEthHash(hash);
      if (!h) continue;
      const txRes = await fetch(
        `https://api.blockcypher.com/v1/eth/main/txs/${h}`,
        { next: { revalidate: 300 } }
      );
      if (!txRes.ok) continue;
      const tx: BlockCypherTx = await txRes.json();
      const addrs = new Set<string>();
      for (const inp of tx.inputs ?? []) for (const a of inp.addresses ?? []) addrs.add(a);
      for (const out of tx.outputs ?? []) for (const a of out.addresses ?? []) addrs.add(a);
      addrs.delete(address);
      addrs.forEach((a) => {
        counterpartyCounts.set(a, (counterpartyCounts.get(a) ?? 0) + 1);
      });
    }

    const entities: OSINTEntity[] = [];
    const edges: OSINTEdge[] = [];

    const sorted = Array.from(counterpartyCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);

    for (const [addr, count] of sorted) {
      const walletEntity: OSINTEntity = {
        id: generateId(),
        type: 'wallet_eth',
        value: addr,
        label: `${addr.slice(0, 10)}...${addr.slice(-6)}`,
        metadata: { address: addr, transaction_count: count, chain: 'ethereum' },
        source: 'eth-connected',
        verified: true,
        timestamp: new Date().toISOString()
      };
      entities.push(walletEntity);
      edges.push({
        id: generateEdgeId(),
        sourceId,
        targetId: walletEntity.id,
        label: `Transacted (${count}x)`,
        relationship: 'transacted_with'
      });
    }

    return {
      success: true,
      entities,
      edges,
      message: `Found ${entities.length} connected wallets`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error:
        error instanceof Error
          ? error.message
          : 'Failed to fetch connected wallets',
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Get counterparties from a transaction hash
 */
async function getBtcTransactionCounterparties(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const txHash = input.entity.value.trim();
  const sourceId = input.entity.id;

  // Valida hash transazione (64 caratteri hex)
  if (!isBtcTxHash(txHash)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid transaction hash format (expected 64 hex characters)',
      executionTime: Date.now() - startTime
    };
  }

  try {
    const response = await fetch(
      `https://blockchain.info/rawtx/${txHash}`,
      { next: { revalidate: 3600 } } // Cache per 1 ora (tx immutabili)
    );

    if (!response.ok) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: `Blockchain.com API error: ${response.status}`,
        executionTime: Date.now() - startTime
      };
    }

    const tx = await response.json();
    const entities: OSINTEntity[] = [];
    const edges: OSINTEdge[] = [];
    const seenAddresses = new Set<string>();

    // Estrai indirizzi di input (sender)
    for (const inp of tx.inputs || []) {
      const addr = inp.prev_out?.addr;
      if (addr && !seenAddresses.has(addr)) {
        seenAddresses.add(addr);
        const value = inp.prev_out?.value || 0;
        const walletEntity: OSINTEntity = {
          id: generateId(),
          type: 'wallet_btc',
          value: addr,
          label: `${addr.slice(0, 8)}...${addr.slice(-6)}`,
          metadata: {
            address: addr,
            role: 'sender',
            amount_btc: satoshiToBTC(value)
          },
          source: 'blockchain-tx-counterparty',
          verified: true,
          timestamp: new Date().toISOString()
        };
        entities.push(walletEntity);
        edges.push({
          id: generateEdgeId(),
          sourceId,
          targetId: walletEntity.id,
          label: `Sender (${satoshiToBTC(value)} BTC)`,
          relationship: 'tx_sender'
        });
      }
    }

    // Estrai indirizzi di output (receiver)
    for (const out of tx.out || []) {
      const addr = out.addr;
      if (addr && !seenAddresses.has(addr)) {
        seenAddresses.add(addr);
        const value = out.value || 0;
        const walletEntity: OSINTEntity = {
          id: generateId(),
          type: 'wallet_btc',
          value: addr,
          label: `${addr.slice(0, 8)}...${addr.slice(-6)}`,
          metadata: {
            address: addr,
            role: 'receiver',
            amount_btc: satoshiToBTC(value)
          },
          source: 'blockchain-tx-counterparty',
          verified: true,
          timestamp: new Date().toISOString()
        };
        entities.push(walletEntity);
        edges.push({
          id: generateEdgeId(),
          sourceId,
          targetId: walletEntity.id,
          label: `Receiver (${satoshiToBTC(value)} BTC)`,
          relationship: 'tx_receiver'
        });
      }
    }

    return {
      success: true,
      entities,
      edges,
      message: `Found ${entities.length} counterparties in transaction`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error:
        error instanceof Error
          ? error.message
          : 'Failed to fetch transaction details',
      executionTime: Date.now() - startTime
    };
  }
}

async function getEthTransactionCounterparties(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const txHash = input.entity.value.trim();
  const sourceId = input.entity.id;

  if (!isEthTxHash(txHash)) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Invalid Ethereum transaction hash format (expected 0x + 64 hex)',
      executionTime: Date.now() - startTime
    };
  }

  try {
    const h = normalizeEthHash(txHash);
    const response = await fetch(
      `https://api.blockcypher.com/v1/eth/main/txs/${h}`,
      { next: { revalidate: 3600 } }
    );
    if (!response.ok) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: `BlockCypher API error: ${response.status}`,
        executionTime: Date.now() - startTime
      };
    }

    const tx: BlockCypherTx = await response.json();
    const entities: OSINTEntity[] = [];
    const edges: OSINTEdge[] = [];
    const seen = new Set<string>();

    const pushWallet = (addr: string, role: 'sender' | 'receiver') => {
      if (!addr || seen.has(addr)) return;
      seen.add(addr);
      const walletEntity: OSINTEntity = {
        id: generateId(),
        type: 'wallet_eth',
        value: addr,
        label: `${addr.slice(0, 10)}...${addr.slice(-6)}`,
        metadata: { address: addr, role, chain: 'ethereum' },
        source: 'eth-tx-counterparty',
        verified: true,
        timestamp: new Date().toISOString()
      };
      entities.push(walletEntity);
      edges.push({
        id: generateEdgeId(),
        sourceId,
        targetId: walletEntity.id,
        label: role === 'sender' ? 'Sender' : 'Receiver',
        relationship: role === 'sender' ? 'tx_sender' : 'tx_receiver'
      });
    };

    for (const inp of tx.inputs ?? []) for (const a of inp.addresses ?? []) pushWallet(a, 'sender');
    for (const out of tx.outputs ?? []) for (const a of out.addresses ?? []) pushWallet(a, 'receiver');

    return {
      success: true,
      entities,
      edges,
      message: `Found ${entities.length} counterparties in transaction`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error:
        error instanceof Error
          ? error.message
          : 'Failed to fetch transaction details',
      executionTime: Date.now() - startTime
    };
  }
}

/**
 * Plugin executor
 */
export const blockchainPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    const entityType = input.entity.type;
    switch (transformId) {
      case 'wallet-balance':
        return entityType === 'wallet_eth' ? getEthWalletBalance(input) : getBtcWalletBalance(input);
      case 'wallet-transactions':
        return entityType === 'wallet_eth' ? getEthTransactions(input) : getBtcTransactions(input);
      case 'wallet-connected':
        return entityType === 'wallet_eth'
          ? getEthConnectedWallets(input)
          : getBtcConnectedWallets(input);
      case 'tx-counterparties':
        return isEthTxHash(input.entity.value)
          ? getEthTransactionCounterparties(input)
          : getBtcTransactionCounterparties(input);
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

export default blockchainPluginExecutor;

/**
 * Blockchain.com (BTC-only) executor - usato dal plugin "blockchain"
 */
export const blockchainComPluginExecutor: PluginExecutor = {
  async execute(transformId: string, input: TransformInput) {
    switch (transformId) {
      case 'wallet-balance':
        return getBtcWalletBalance(input);
      case 'wallet-transactions':
        return getBtcTransactions(input);
      case 'wallet-connected':
        return getBtcConnectedWallets(input);
      case 'tx-counterparties':
        return getBtcTransactionCounterparties(input);
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

/**
 * BlockCypher (ETH-only) executor - usato dal plugin "blockcypher"
 */
export const blockcypherPluginExecutor: PluginExecutor = {
  async execute(transformId: string, input: TransformInput) {
    switch (transformId) {
      case 'wallet-balance':
        return getEthWalletBalance(input);
      case 'wallet-transactions':
        return getEthTransactions(input);
      case 'wallet-connected':
        return getEthConnectedWallets(input);
      case 'tx-counterparties':
        return getEthTransactionCounterparties(input);
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
