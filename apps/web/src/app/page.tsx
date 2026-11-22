'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { ScreenLoader } from '@/components/Loader';
import { useSession } from '@/lib/session';

export default function Index() {
  const { me, loading, isBranchUser } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(!me ? '/login' : me.isSuper ? '/super' : isBranchUser ? '/b/home' : '/dashboard');
  }, [loading, me, isBranchUser, router]);
  return <ScreenLoader />;
}
