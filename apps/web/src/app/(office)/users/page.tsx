'use client';

import { UsersManager } from '@/components/settings/UsersManager';
import { useT } from '@/lib/i18n';
import { useSession } from '@/lib/session';

export default function UsersPage() {
  const { t } = useT();
  const { can } = useSession();
  if (!can('user:manage')) return <p className="card">{t('noAccess')}</p>;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">{t('usersTitle')}</h2>
      <UsersManager />
    </div>
  );
}
