/**
 * Configurazione centralizzata per i tipi di entità OSINT
 * Usata sia nel grafo che nelle pagine plugin
 */

import {
  entityTypes,
  nodeTypeByType,
  type EntityType
} from '@/features/osint/node-registry';

export interface EntityTypeConfig {
  icon: any;
  label: string;
  color: string;
  headerBg: string;
  headerText: string;
  bodyBg: string;
  borderColor: string;
}

const entityTypeConfigByType: Record<EntityType, EntityTypeConfig> =
  entityTypes.reduce((acc, type) => {
    const def = nodeTypeByType[type];
    acc[type] = {
      icon: def.icon,
      label: def.label,
      color: def.colorHex,
      headerBg: def.ui.headerBg,
      headerText: def.ui.headerText,
      bodyBg: def.ui.bodyBg,
      borderColor: def.ui.borderColor
    };
    return acc;
  }, {} as Record<EntityType, EntityTypeConfig>);

/**
 * Ottieni la configurazione per un tipo di entità
 */
export function getEntityConfig(type: string): EntityTypeConfig {
  if (type in entityTypeConfigByType) return entityTypeConfigByType[type as EntityType];
  return entityTypeConfigByType.custom;
}

/**
 * Ottieni il colore CSS per un tipo di entità
 */
export function getEntityColor(type: string): string {
  const config = getEntityConfig(type);
  return config.color;
}

/**
 * Ottieni l'icona per un tipo di entità
 */
export function getEntityIcon(type: string) {
  const config = getEntityConfig(type);
  return config.icon;
}
