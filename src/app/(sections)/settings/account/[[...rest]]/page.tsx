/** Settings -> Account: local profile, password and session management. */

import ProfileViewPage from '@/features/profile/components/profile-view-page';

export const metadata = {
  title: 'Settings : Account'
};

export default function AccountSettingsPage() {
  return <ProfileViewPage embedded showSessionManagement />;
}
