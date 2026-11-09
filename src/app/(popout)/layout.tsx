import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Browser',
  description: 'Minimal browser popout'
};

export default function PopoutLayout({ children }: { children: React.ReactNode }) {
  return <div className='h-dvh w-dvw overflow-hidden bg-black'>{children}</div>;
}
