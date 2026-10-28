import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Node } from 'reactflow';
import { AgentMarkdown, AgentMentionProvider } from './agent-markdown';
import {
  registerAgentGraphReferences,
  useAgentGraphReferences
} from '../store/agent-graph-references';

const node = (id: string, label: string): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: { label, type: 'domain', metadata: { customColor: '#abcdef' } }
});
function render(
  text: string,
  nodes = [node('node-1', 'example.org')],
  animate = false
) {
  return renderToStaticMarkup(
    // Required by the provider's typed props in this non-JSX test.
    // eslint-disable-next-line react/no-children-prop
    createElement(AgentMentionProvider, {
      value: { nodes, onSelectNode: () => {} },
      children: createElement(AgentMarkdown, { text, animate })
    })
  );
}

describe('agent graph citations', () => {
  it('never retargets an explicit mention based on its old label', () => {
    const html = render('[example.org](#graph-node=removed)', [
      node('different', 'example.org')
    ]);
    expect(html).not.toContain('data-node-id');
    const duplicates = render('[same](#graph-node=b)', [
      node('a', 'same'),
      node('b', 'same')
    ]);
    expect(duplicates).toContain('data-node-id="b"');
    expect(duplicates).not.toContain('data-node-id="a"');
  });
  it('reveals words in order while preserving formatting and atomic graph citations', () => {
    const html = render(
      'Ho trovato **nuovi nodi**: example.org.\n\n- Primo risultato\n\n```text\ncode unchanged\n```',
      undefined,
      true
    );
    expect(html).toContain('data-response-word');
    expect(html).toContain('animation-delay:0ms');
    expect(html).toContain('animation-delay:24ms');
    expect(html).toContain('<strong><span');
    expect(html).toContain('<li><span');
    expect(html.match(/data-node-id="node-1"/g)).toHaveLength(1);
    expect(html).toContain('code unchanged\n</code></pre>');
    expect(html).not.toMatch(
      /<button[^>]*>[\s\S]*?data-response-word[\s\S]*?<\/button>/
    );
  });
  it('does not animate historical markdown and bounds long answer delays', () => {
    expect(render('Existing answer')).not.toContain('data-response-word');
    const html = render('word '.repeat(1000), [], true);
    const delays = Array.from(
      html.matchAll(/animation-delay:(\d+)ms/g),
      (match) => Number(match[1])
    );
    expect(delays).toHaveLength(1000);
    expect(Math.max(...delays)).toBe(1200);
  });
  it.each(['domain', 'url', 'subdomain', 'hostname'])(
    'uses site branding and the graph header color for %s',
    (type) => {
      const label = type === 'url' ? 'https://bumble.com/about' : 'bumble.com';
      const branded = node('bumble', label);
      branded.data = {
        type,
        label,
        metadata: {
          customColor: '#ffc629',
          headerTextColor: '#896400',
          autoColorFromLogo: true
        }
      };
      const html = render(label, [branded]);
      expect(html).toContain('/api/logo?domain=bumble.com');
      expect(html).toContain('--reference-accent:#896400');
      expect(html).not.toContain('/api/public/entity-icons/');
    }
  );
  it('uses an inline SVG in the custom color when a node has no site logo', () => {
    const custom = node('ip', '192.0.2.1');
    custom.data.type = 'ip';
    const html = render('192.0.2.1', [custom]);
    expect(html).toContain('<svg');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('--reference-accent:#abcdef');
    expect(html).not.toContain('<img');
  });
  it('ignores invalid custom colors and arbitrary metadata image URLs', () => {
    const custom = node('bad', 'not a domain');
    custom.data.metadata = {
      customColor: 'red;display:none',
      headerTextColor: 'url(https://evil.invalid)',
      logoUrl: 'https://evil.invalid/image.png'
    };
    const html = render('not a domain', [custom]);
    expect(html).not.toContain('evil.invalid');
    expect(html).not.toContain('display:none');
    expect(html).toContain('<svg');
  });
  it('renders known labels, IDs, inline code and markdown links using node UI', () => {
    const html = render(
      'Controllo **example.org**, `node-1` e [example.org](https://example.org).'
    );
    expect(html.match(/data-node-id="node-1"/g)).toHaveLength(3);
    expect(html).toContain('case-reference-mention');
    expect(html).toContain('--reference-accent:#abcdef');
    expect(html).toContain('/api/logo?domain=example.org');
  });
  it('does not match substrings of other domains, URLs, emails or node IDs', () => {
    const html = render(
      'otherexample.org sub.example.org example.org.uk user@example.org https://example.org/path node-12'
    );
    expect(html).not.toContain('data-node-id');
  });
  it('preserves punctuation and chooses the longest exact label', () => {
    const html = render('example.org. sub.example.org!', [
      node('one', 'example.org'),
      node('two', 'sub.example.org')
    ]);
    expect(html.match(/data-node-id=/g)).toHaveLength(2);
    expect(html).toContain('data-node-id="two"');
  });
  it('leaves ambiguous, deleted and out-of-scope nodes as ordinary text', () => {
    expect(
      render('example.org', [
        node('one', 'example.org'),
        node('two', 'example.org')
      ])
    ).not.toContain('data-node-id');
    expect(render('example.org node-1', [])).not.toContain('data-node-id');
    expect(render('[removed](#graph-node=missing)')).not.toContain('<a');
    expect(render('[bad](#graph-node=%E0%A4%A)')).not.toContain('<a');
  });
  it('does not rewrite code blocks or render model-provided images/unsafe links', () => {
    expect(render('```sh\necho example.org\n```')).not.toContain(
      'data-node-id'
    );
    expect(render('![image](https://external.invalid/test.png)')).not.toContain(
      '<img'
    );
    expect(render('[click](javascript:alert)')).not.toContain(
      'href="javascript'
    );
    expect(render('[source](https://source.org)')).toContain(
      'href="https://source.org"'
    );
  });
  it('can reference IDs containing encoded URL characters', () => {
    const html = render('[entity](#graph-node=node%2Fone)', [
      node('node/one', 'Entity')
    ]);
    expect(html).toContain('data-node-id="node/one"');
  });
  it('scopes editor registrations and does not clear a newer registration', () => {
    const first = registerAgentGraphReferences('a', {
      nodes: [node('1', 'A')],
      onSelectNode: () => {}
    });
    const second = registerAgentGraphReferences('a', {
      nodes: [node('2', 'B')],
      onSelectNode: () => {}
    });
    const other = registerAgentGraphReferences('b', {
      nodes: [],
      onSelectNode: () => {}
    });
    first();
    expect(useAgentGraphReferences.getState().graphs.a.nodes[0].id).toBe('2');
    second();
    expect(useAgentGraphReferences.getState().graphs.a).toBeUndefined();
    expect(useAgentGraphReferences.getState().graphs.b).toBeDefined();
    other();
  });
});
