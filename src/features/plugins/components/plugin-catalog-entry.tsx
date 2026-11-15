'use client';

import type { ReactNode } from 'react';
import { SettingsRow } from '@/features/settings/settings-fields';
import type { PluginTransformSummary } from './plugin-transforms';
import styles from './plugin-catalog-entry.module.css';

export function PluginCatalogEntry({
  name,
  description,
  version,
  transforms,
  needsConfiguration,
  onDetails,
  children
}: {
  name: string;
  description: string;
  version: string;
  transforms: readonly PluginTransformSummary[];
  needsConfiguration: boolean;
  onDetails: () => void;
  children: ReactNode;
}) {
  return (
    <div className={styles.entry}>
      <SettingsRow
        className={styles.summary}
        label={
          <button
            type='button'
            className={styles.trigger}
            aria-label={`View ${name} details`}
            onClick={onDetails}
          >
            <span className={styles.title}>{name}</span>
            <span className={`${styles.description} line-clamp-2`}>
              {description}
            </span>
            <span className={styles.meta}>
              {transforms.length}{' '}
              {transforms.length === 1 ? 'transform' : 'transforms'} · v
              {version}
              {needsConfiguration ? ' · Configuration required' : ''}
            </span>
          </button>
        }
      >
        {children}
      </SettingsRow>
    </div>
  );
}
