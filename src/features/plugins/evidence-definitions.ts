import type { PluginDefinition } from './types';

export const emailHeadersPlugin: PluginDefinition = {
  id: 'email-headers',
  name: 'Email Header Analysis',
  description:
    'Extracts mailboxes and relay IPs from pasted email headers. Summarizes declared SPF, DKIM and DMARC results without treating them as verified.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconMailSearch',
  category: 'identity',
  type: 'builtin-js',
  runtime: 'nextjs',
  inputTypes: ['note'],
  outputTypes: ['email', 'domain', 'ip', 'note'],
  transforms: [
    {
      id: 'email-headers-extract',
      name: 'Analyze Email Headers',
      description:
        'Paste raw email headers in a note to extract addresses, relay IPs and declared authentication results. No network requests.',
      inputType: 'note',
      outputTypes: ['email', 'domain', 'ip', 'note']
    }
  ],
  estimatedTime: 'instant',
  enabled: true
};

export const hashEvidencePlugin: PluginDefinition = {
  id: 'hash-evidence',
  name: 'Hash & Evidence Toolkit',
  description:
    'Identifies possible digest formats and computes SHA-256 fingerprints of exact note text. All processing stays on this instance.',
  version: '1.0.0',
  author: 'PARANOD Team',
  icon: 'IconFingerprint',
  category: 'documents',
  type: 'builtin-js',
  runtime: 'nextjs',
  inputTypes: ['hash', 'note'],
  outputTypes: ['hash', 'note'],
  transforms: [
    {
      id: 'hash-identify',
      name: 'Identify Hash Format',
      description:
        'Lists candidate algorithms from hexadecimal length; does not identify a file or prove which algorithm produced the digest.',
      inputType: 'hash',
      outputTypes: ['note']
    },
    {
      id: 'evidence-sha256',
      name: 'Fingerprint Note Text (SHA-256)',
      description:
        'Hashes the exact UTF-8 note text, preserving whitespace and line endings. This is a text fingerprint, not a hash of an attached file.',
      inputType: 'note',
      outputTypes: ['hash']
    }
  ],
  estimatedTime: 'instant',
  enabled: true
};
