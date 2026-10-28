'use client';

import { usePathname } from 'next/navigation';
import { useMemo, useState, useEffect } from 'react';

type BreadcrumbItem = {
  title: string;
  link: string;
};

// This allows to add custom title as well
const routeMapping: Record<string, BreadcrumbItem[]> = {
  '/graphs': [
    { title: 'Workspace', link: '/' },
    { title: 'Graphs', link: '/graphs' }
  ],
  '/flows': [
    { title: 'Workspace', link: '/' },
    { title: 'Flows', link: '/flows' }
  ],
  '/plugins': [
    { title: 'Workspace', link: '/' },
    { title: 'Plugins', link: '/plugins' }
  ],
  '/settings': [
    { title: 'Workspace', link: '/' },
    { title: 'Settings', link: '/settings' }
  ],
  '/settings/workspace': [
    { title: 'Workspace', link: '/' },
    { title: 'Workspaces', link: '/settings/workspace' }
  ],
  '/profile': [
    { title: 'Workspace', link: '/' },
    { title: 'Profile', link: '/profile' }
  ],
  '/cases': [
    { title: 'Workspace', link: '/' },
    { title: 'Cases', link: '/cases' }
  ]
};

export function useBreadcrumbs() {
  const pathname = usePathname();
  const [dynamicTitle, setDynamicTitle] = useState<string | null>(null);

  // Fetch graph/flow/case name for dynamic routes
  useEffect(() => {
    const caseMatch = pathname.match(/^\/cases\/([^/]+)$/);
    if (caseMatch) {
      setDynamicTitle(null);
      const caseId = caseMatch[1];
      fetch(`/api/cases/${caseId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.case?.name) setDynamicTitle(data.case.name);
        })
        .catch(() => {});
      return;
    }

    const graphMatch = pathname.match(/^\/graphs\/([^/]+)$/);
    if (graphMatch) {
      const graphId = graphMatch[1];
      fetch(`/api/graphs/${graphId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.graph?.name) {
            setDynamicTitle(data.graph.name);
          }
        })
        .catch(() => {});
      return;
    }

    const flowMatch = pathname.match(/^\/flows\/([^/]+)$/);
    if (flowMatch) {
      const flowId = flowMatch[1];
      fetch(`/api/flows/${flowId}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.flow?.name) setDynamicTitle(data.flow.name);
        })
        .catch(() => {});
      return;
    }

    setDynamicTitle(null);
  }, [pathname]);

  const breadcrumbs = useMemo(() => {
    // Check if we have a custom mapping for this exact path
    if (routeMapping[pathname]) {
      return routeMapping[pathname];
    }

    // Check for dynamic graph route
    const graphMatch = pathname.match(/^\/graphs\/([^/]+)$/);
    if (graphMatch) {
      return [
        { title: 'Workspace', link: '/' },
        { title: 'Graphs', link: '/graphs' },
        { title: dynamicTitle || 'Loading...', link: pathname }
      ];
    }

    const flowMatch = pathname.match(/^\/flows\/([^/]+)$/);
    if (flowMatch) {
      return [
        { title: 'Workspace', link: '/' },
        { title: 'Flows', link: '/flows' },
        { title: dynamicTitle || 'Loading...', link: pathname }
      ];
    }

    const caseMatch = pathname.match(/^\/cases\/([^/]+)$/);
    if (caseMatch) {
      return [
        { title: 'Workspace', link: '/' },
        { title: 'Cases', link: '/cases' },
        { title: dynamicTitle || 'Loading...', link: pathname }
      ];
    }

    // If no exact match, fall back to generating breadcrumbs from the path
    const segments = pathname.split('/').filter(Boolean);
    return segments.map((segment, index) => {
      const path = `/${segments.slice(0, index + 1).join('/')}`;
      return {
        title: segment.charAt(0).toUpperCase() + segment.slice(1),
        link: path
      };
    });
  }, [pathname, dynamicTitle]);

  return breadcrumbs;
}
