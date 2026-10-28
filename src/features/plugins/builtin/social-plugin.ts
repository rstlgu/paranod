/**
 * Social Media Plugin
 * Handles social media profiles across different platforms
 */

import type {
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge
} from '../types';

function generateEntityId(): string {
  return `entity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Extract platform info from social profile
 */
export async function extractPlatformInfo(
  input: TransformInput
): Promise<TransformResult> {
  const { entity } = input;
  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  try {
    // Extract platform from entity type
    let platform = 'unknown';
    let profileType = 'user';

    if (entity.type.startsWith('instagram_')) {
      platform = 'Instagram';
      profileType = entity.type.replace('instagram_', '');
    } else if (entity.type.startsWith('telegram_')) {
      platform = 'Telegram';
      profileType = entity.type.replace('telegram_', '');
    } else if (entity.type.startsWith('facebook_')) {
      platform = 'Facebook';
      profileType = entity.type.replace('facebook_', '');
    } else if (entity.type === 'social') {
      platform = 'Generic';
      profileType = 'profile';
    }

    // Create a note with platform information
    const noteId = generateEntityId();
    entities.push({
      id: noteId,
      type: 'note',
      value: `Platform: ${platform}\nType: ${profileType}\nProfile: ${entity.value}`,
      label: `${platform} ${profileType} info`,
      metadata: {
        platform,
        profileType,
        username: entity.value
      },
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: noteId,
      label: 'has info',
      relationship: 'related_to'
    });

    return {
      success: true,
      entities,
      edges,
      message: `Extracted ${platform} profile information`
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: error instanceof Error ? error.message : 'Failed to extract info'
    };
  }
}

/**
 * Generate search URLs for social profile
 */
export async function generateSearchLinks(
  input: TransformInput
): Promise<TransformResult> {
  const { entity } = input;
  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  try {
    const username = entity.value;
    let platform = '';

    if (entity.type.startsWith('instagram_')) {
      platform = 'Instagram';
      const urlId = generateEntityId();
      entities.push({
        id: urlId,
        type: 'url',
        value: `https://www.instagram.com/${username}`,
        label: `https://www.instagram.com/${username}`,
        metadata: { platform: 'Instagram' },
        timestamp: new Date().toISOString()
      });
      edges.push({
        id: generateEdgeId(),
        sourceId: entity.id,
        targetId: urlId,
        label: 'profile URL',
        relationship: 'related_to'
      });
    } else if (entity.type.startsWith('telegram_')) {
      platform = 'Telegram';
      const urlId = generateEntityId();
      entities.push({
        id: urlId,
        type: 'url',
        value: `https://t.me/${username}`,
        label: `https://t.me/${username}`,
        metadata: { platform: 'Telegram' },
        timestamp: new Date().toISOString()
      });
      edges.push({
        id: generateEdgeId(),
        sourceId: entity.id,
        targetId: urlId,
        label: 'profile URL',
        relationship: 'related_to'
      });
    } else if (entity.type.startsWith('facebook_')) {
      platform = 'Facebook';
      const urlId = generateEntityId();
      entities.push({
        id: urlId,
        type: 'url',
        value: `https://www.facebook.com/${username}`,
        label: `https://www.facebook.com/${username}`,
        metadata: { platform: 'Facebook' },
        timestamp: new Date().toISOString()
      });
      edges.push({
        id: generateEdgeId(),
        sourceId: entity.id,
        targetId: urlId,
        label: 'profile URL',
        relationship: 'related_to'
      });
    }

    return {
      success: true,
      entities,
      edges,
      message: `Generated ${platform} profile URL`
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: error instanceof Error ? error.message : 'Failed to generate links'
    };
  }
}
