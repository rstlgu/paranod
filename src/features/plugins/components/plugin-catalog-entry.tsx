'use client';

import type { ReactNode } from 'react';
import { CaretRight } from '@phosphor-icons/react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@/components/ui/collapsible';
import { SettingsRow } from '@/features/settings/settings-fields';
import {
  PluginTransforms,
  type PluginTransformSummary
} from './plugin-transforms';
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
    <Collapsible className={styles.entry}>
      <SettingsRow
        className={styles.summary}
        label={
          <CollapsibleTrigger asChild>
            <button
              type='button'
              className={styles.trigger}
              aria-label={`${name} transforms`}
            >
              <span className={styles.title}>
                <CaretRight size={15} aria-hidden='true' />
                {name}
              </span>
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
          </CollapsibleTrigger>
        }
      >
        {children}
      </SettingsRow>
      <CollapsibleContent
        className={styles.content}
        role='region'
        aria-label={`${name} transforms`}
      >
        <div className={styles.expanded}>
          <div className={styles.expandedHeading}>
            <h3>Transforms</h3>
            <button type='button' onClick={onDetails}>
              View details
            </button>
          </div>
          <PluginTransforms transforms={transforms} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
