'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@/components/ui';
import { useSession } from '@/lib/session';

export default function Index() {
  const { me, loading, isBranchUser } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (loading) return;
    router.replace(!me ? '/login' : isBranchUser ? '/b/home' : '/dashboard');
  }, [loading, me, isBranchUser, router]);
  return <div className="mx-auto max-w-md p-6"><Skeleton className="h-32" /></div>;
}
