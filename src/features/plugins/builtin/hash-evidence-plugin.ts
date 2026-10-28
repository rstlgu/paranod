import { createHash } from 'node:crypto';
import type { PluginExecutor } from '../types';
import { evidenceText } from './evidence-utils';
import { osintEdge, osintEntity, osintFail } from './osint-utils';

const CANDIDATES: Record<number, string[]> = {
  32: ['MD5', 'MD4', 'NTLM (MD4 of UTF-16LE password)'],
  40: ['SHA-1', 'RIPEMD-160'],
  56: ['SHA-224', 'SHA3-224'],
  64: ['SHA-256', 'SHA3-256', 'BLAKE2s-256'],
  96: ['SHA-384', 'SHA3-384'],
  128: ['SHA-512', 'SHA3-512', 'BLAKE2b-512']
};

export const hashEvidencePluginExecutor: PluginExecutor = {
  async execute(transformId, input) {
    const startedAt = Date.now();
    try {
      let result;
      if (transformId === 'evidence-sha256' && input.entity.type === 'note') {
        const text = evidenceText(input);
        const digest = createHash('sha256').update(text, 'utf8').digest('hex');
        result = osintEntity('hash-evidence', 'hash', digest, digest, {
          algorithm: 'SHA-256',
          encoding: 'UTF-8',
          byteLength: Buffer.byteLength(text, 'utf8'),
          scope: 'Exact note text; not the bytes of an attached file',
          normalization: 'none',
          inputField:
            input.entity.metadata?.content !== undefined
              ? 'metadata.content'
              : 'value'
        });
      } else if (
        transformId === 'hash-identify' &&
        input.entity.type === 'hash'
      ) {
        const digest = evidenceText(input).trim().toLowerCase();
        const candidates = CANDIDATES[digest.length];
        if (!/^[a-f0-9]+$/.test(digest) || !candidates) {
          return osintFail(
            'Expected a hexadecimal digest of 32, 40, 56, 64, 96 or 128 characters',
            startedAt
          );
        }
        const content = `Hash format analysis\n\nDigest: ${digest}\nLength: ${digest.length * 4} bits\nPossible algorithms: ${candidates.join(', ')}\n\nLength alone cannot establish the algorithm. This list is not exhaustive. No reputation lookup or file verification was performed.`;
        result = osintEntity('hash-evidence', 'note', content, content, {
          content,
          digest,
          bitLength: digest.length * 4,
          candidateAlgorithms: candidates,
          inference: 'hexadecimal-length-only'
        });
      } else {
        return osintFail(
          'Unknown transform or unsupported entity type',
          startedAt
        );
      }
      return {
        success: true,
        entities: [result],
        edges: [
          osintEdge(
            input.entity.id,
            result.id,
            'Derived from text',
            'extracted_from'
          )
        ],
        executionTime: Date.now() - startedAt
      };
    } catch (error) {
      return osintFail(
        error instanceof Error ? error.message : 'Invalid input',
        startedAt
      );
    }
  }
};
