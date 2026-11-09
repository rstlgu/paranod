import { describe, expect, it } from 'vitest';
import { parseAgentDraft, serializeAgentDraft } from './composer-document';

describe('agent composer mentions', () => {
  it('preserves text, newlines and literal HTML without interpreting markup', () => {
    const text = 'Check <script>alert(1)</script>\n\n@not a mention\n';
    const doc = parseAgentDraft(text);
    expect(serializeAgentDraft(doc)).toBe(text);
    expect(doc.content?.[0].content?.[0].type).toBe('text');
  });
  it('round trips duplicate labels using explicit node identities', () => {
    const text = 'Compare [Same](#graph-node=a) and [Same](#graph-node=b).';
    const doc = parseAgentDraft(text);
    expect(
      doc.content?.[0].content
        ?.filter((n) => n.type === 'mention')
        .map((n) => n.attrs?.id)
    ).toEqual(['a', 'b']);
    expect(serializeAgentDraft(doc)).toBe(text);
  });
  it('escapes unusual labels and IDs while preserving their identity', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { id: 'node() / ü', label: 'name [x] \\ test' }
            }
          ]
        }
      ]
    };
    const text = serializeAgentDraft(doc);
    const parsed = parseAgentDraft(text).content![0].content![0];
    expect(parsed.attrs?.id).toBe('node() / ü');
    expect(parsed.attrs?.label).toBe('name [x] \\ test');
    expect(serializeAgentDraft(parseAgentDraft(text))).toBe(text);
  });
  it('leaves malformed references as text', () => {
    const text = '[Bad](#graph-node=%zz) [Empty](#graph-node=)';
    expect(parseAgentDraft(text).content![0].content).toEqual([
      { type: 'text', text }
    ]);
  });
});
