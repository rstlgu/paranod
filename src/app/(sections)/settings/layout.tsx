import { SettingsWindow } from '@/features/settings/settings-window';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SettingsWindow direct>{children}</SettingsWindow>;
}
