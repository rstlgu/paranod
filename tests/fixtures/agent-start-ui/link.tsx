import type { AnchorHTMLAttributes } from 'react';

// This isolated Vite fixture has no Next router or server runtime.
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} />;
}
