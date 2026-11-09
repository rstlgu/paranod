/**
 * Legacy: il profilo è confluito in /settings/account.
 */

import { redirect } from 'next/navigation';

export default function Page() {
  redirect('/settings/account');
}
