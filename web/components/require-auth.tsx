'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { PageLoading } from '@/components/app-shell';
import { useAuth } from '@/components/providers';
import { roleHome } from '@/lib/format';
import type { UserRole } from '@/lib/types';

export function RequireAuth({
  roles,
  children,
}: {
  roles: UserRole[];
  children: ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    } else if (!roles.includes(user.role)) {
      router.replace(roleHome(user.role));
    }
  }, [loading, user, roles, pathname, router]);

  if (loading || !user || !roles.includes(user.role)) return <PageLoading />;
  return children;
}
