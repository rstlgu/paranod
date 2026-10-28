import { AppShellLayout } from '@/components/layout/app-shell-layout';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Paranod',
  description:
    'Open-source OSINT platform with modular plugins, graph exploration and an AI agent.'
};

export default async function DashboardLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return await AppShellLayout({ children });
}
