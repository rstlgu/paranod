import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Fragment, type ReactNode } from 'react';

export interface MarkdownProps {
  value: string;
  className?: string;
}

function isExternalHref(href: string) {
  return href.startsWith('http://') || href.startsWith('https://');
}

function normalizeHref(href?: string) {
  const raw = (href ?? '').trim();
  if (!raw) return null;
  if (raw.startsWith('#')) return raw;
  if (raw.startsWith('/')) return raw;

  try {
    const url = new URL(raw, 'https://example.com');
    const protocol = url.protocol.toLowerCase();
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:')
      return raw;
    return null;
  } catch {
    return null;
  }
}

export function Markdown({ value, className }: MarkdownProps) {
  const components: Components = {
    h1: (props) => <h1 className='text-base font-semibold' {...props} />,
    h2: (props) => <h2 className='text-sm font-semibold' {...props} />,
    h3: (props) => <h3 className='text-sm font-semibold' {...props} />,
    p: ({ children, ...props }) => (
      <p className='whitespace-pre-wrap text-sm leading-relaxed' {...props}>
        {children}
      </p>
    ),
    ul: (props) => <ul className='ml-4 list-disc space-y-1 text-sm' {...props} />,
    ol: (props) => (
      <ol className='ml-4 list-decimal space-y-1 text-sm' {...props} />
    ),
    blockquote: (props) => (
      <blockquote
        className='border-border text-muted-foreground border-l-2 pl-3 text-sm'
        {...props}
      />
    ),
    hr: (props) => <hr className='border-border my-2' {...props} />,
    code: ({ className, children, ...props }) => {
      const isInline = !String(className ?? '').includes('language-');
      if (isInline)
        return (
          <code
            className='bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[0.85em]'
            {...props}
          >
            {children}
          </code>
        );

      return (
        <pre className='bg-muted text-foreground overflow-auto rounded-md p-2 font-mono text-xs leading-relaxed'>
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      );
    },
    a: ({ href, children, ...props }) => {
      const safeHref = normalizeHref(href);
      if (!safeHref) return <Fragment>{children as ReactNode}</Fragment>;

      if (safeHref.startsWith('/'))
        return (
          <Link
            href={safeHref}
            className='text-primary underline underline-offset-2'
          >
            {children}
          </Link>
        );

      return (
        <a
          href={safeHref}
          className='text-primary underline underline-offset-2'
          target={isExternalHref(safeHref) ? '_blank' : undefined}
          rel={isExternalHref(safeHref) ? 'noreferrer noopener' : undefined}
          {...props}
        >
          {children}
        </a>
      );
    }
  };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Sicurezza: NON abilitiamo raw HTML (rehype-raw), quindi niente XSS via HTML.
        components={components}
      >
        {value}
      </ReactMarkdown>
    </div>
  );
}
