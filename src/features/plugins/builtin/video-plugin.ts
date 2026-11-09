/**
 * Video Analysis Plugin
 * Provides video metadata extraction and analysis
 */

import type {
  PluginExecutor,
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge
} from '../types';

// ============================================
// Helper Functions
// ============================================

function generateId(): string {
  return `vid-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-vid-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// Video Platform Detection
// ============================================

interface VideoInfo {
  platform: string;
  videoId: string;
  embedUrl: string;
  thumbnailUrl?: string;
  apiUrl?: string;
}

function detectVideoPlatform(url: string): VideoInfo | null {
  // YouTube
  const ytMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch) {
    return {
      platform: 'YouTube',
      videoId: ytMatch[1],
      embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}`,
      thumbnailUrl: `https://img.youtube.com/vi/${ytMatch[1]}/maxresdefault.jpg`,
      apiUrl: `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytMatch[1]}&format=json`
    };
  }

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) {
    return {
      platform: 'Vimeo',
      videoId: vimeoMatch[1],
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
      apiUrl: `https://vimeo.com/api/oembed.json?url=https://vimeo.com/${vimeoMatch[1]}`
    };
  }

  // Dailymotion
  const dmMatch = url.match(/dailymotion\.com\/video\/([a-zA-Z0-9]+)/);
  if (dmMatch) {
    return {
      platform: 'Dailymotion',
      videoId: dmMatch[1],
      embedUrl: `https://www.dailymotion.com/embed/video/${dmMatch[1]}`,
      thumbnailUrl: `https://www.dailymotion.com/thumbnail/video/${dmMatch[1]}`
    };
  }

  // Twitter/X
  const twitterMatch = url.match(/(?:twitter|x)\.com\/\w+\/status\/(\d+)/);
  if (twitterMatch) {
    return {
      platform: 'Twitter/X',
      videoId: twitterMatch[1],
      embedUrl: url
    };
  }

  // TikTok
  const tiktokMatch = url.match(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/);
  if (tiktokMatch) {
    return {
      platform: 'TikTok',
      videoId: tiktokMatch[1],
      embedUrl: url
    };
  }

  return null;
}

// ============================================
// Extract Video Metadata
// ============================================

async function extractMetadata(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity } = input;
  const videoUrl = entity.value;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  const videoInfo = detectVideoPlatform(videoUrl);

  if (!videoInfo) {
    // Direct video file - extract what we can
    // Convention: label = displayed content, value = identifier
    const noteContent = `🎬 Direct Video File

URL: ${videoUrl}

Server-side processing required for full metadata extraction.`;

    const noteId = generateId();
    entities.push({
      id: noteId,
      type: 'note',
      value: 'Video Metadata', // Identifier
      label: noteContent, // Displayed in node
      metadata: {
        videoUrl,
        type: 'direct_file'
      },
      source: 'video-analysis',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: noteId,
      label: 'metadata',
      relationship: 'contains'
    });

    return {
      success: true,
      entities,
      edges,
      message: 'Basic video info extracted',
      executionTime: Date.now() - startTime
    };
  }

  // Try to fetch oEmbed data for supported platforms
  if (videoInfo.apiUrl) {
    try {
      const response = await fetch(videoInfo.apiUrl);
      if (response.ok) {
        const data = await response.json();

        // Add video metadata note
        // Convention: label = displayed content, value = identifier
        const videoTitle = data.title || `${videoInfo.platform} Video`;
        const metaContent = `🎬 ${videoTitle}

📺 Platform: ${videoInfo.platform}
👤 Author: ${data.author_name || 'Unknown'}
🔗 Channel: ${data.author_url || 'N/A'}
📐 Resolution: ${data.width || '?'}x${data.height || '?'}
⏱️ Duration: ${data.duration ? `${Math.floor(data.duration / 60)}:${(data.duration % 60).toString().padStart(2, '0')}` : 'N/A'}`;

        const metaId = generateId();
        entities.push({
          id: metaId,
          type: 'note',
          value: 'Video Info', // Identifier
          label: metaContent, // Displayed in node
          metadata: {
            platform: videoInfo.platform,
            videoId: videoInfo.videoId,
            title: data.title,
            author: data.author_name,
            authorUrl: data.author_url,
            thumbnail: data.thumbnail_url || videoInfo.thumbnailUrl,
            width: data.width,
            height: data.height,
            duration: data.duration
          },
          source: 'video-metadata',
          timestamp: new Date().toISOString()
        });

        edges.push({
          id: generateEdgeId(),
          sourceId: entity.id,
          targetId: metaId,
          label: 'video info',
          relationship: 'contains'
        });

        // Add author/channel as person
        if (data.author_name) {
          const authorId = generateId();
          entities.push({
            id: authorId,
            type: 'person',
            value: 'Video Author', // Identifier
            label: data.author_name, // Displayed: actual author name
            metadata: {
              platform: videoInfo.platform,
              profileUrl: data.author_url,
              role: 'Video Author'
            },
            source: 'video-metadata',
            timestamp: new Date().toISOString()
          });

          edges.push({
            id: generateEdgeId(),
            sourceId: entity.id,
            targetId: authorId,
            label: 'uploaded by',
            relationship: 'belongs_to'
          });
        }

        // Add thumbnail as image
        const thumbUrl = data.thumbnail_url || videoInfo.thumbnailUrl;
        if (thumbUrl) {
          const thumbId = generateId();
          entities.push({
            id: thumbId,
            type: 'media_url',
            value: 'Video Thumbnail', // Identifier
            label: thumbUrl, // Displayed: the URL
            metadata: {
              sourceVideo: videoUrl,
              platform: videoInfo.platform
            },
            source: 'video-thumbnail',
            timestamp: new Date().toISOString()
          });

          edges.push({
            id: generateEdgeId(),
            sourceId: entity.id,
            targetId: thumbId,
            label: 'thumbnail',
            relationship: 'contains'
          });
        }
      }
    } catch {
      // oEmbed failed, continue with basic info
    }
  }

  // Always add platform domain
  // Convention: label = displayed (domain), value = identifier
  const domainId = generateId();
  const platformDomain =
    videoInfo.platform === 'YouTube'
      ? 'youtube.com'
      : videoInfo.platform === 'Vimeo'
        ? 'vimeo.com'
        : videoInfo.platform === 'Dailymotion'
          ? 'dailymotion.com'
          : videoInfo.platform === 'TikTok'
            ? 'tiktok.com'
            : 'twitter.com';

  entities.push({
    id: domainId,
    type: 'domain',
    value: videoInfo.platform, // Identifier
    label: platformDomain, // Displayed: actual domain
    metadata: {
      category: 'Video Platform',
      videoId: videoInfo.videoId
    },
    source: 'video-platform',
    timestamp: new Date().toISOString()
  });

  edges.push({
    id: generateEdgeId(),
    sourceId: entity.id,
    targetId: domainId,
    label: 'hosted on',
    relationship: 'hosts'
  });

  return {
    success: true,
    entities,
    edges,
    message: `Extracted metadata from ${videoInfo.platform}`,
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Extract Thumbnails
// ============================================

async function extractThumbnails(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity } = input;
  const videoUrl = entity.value;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  const videoInfo = detectVideoPlatform(videoUrl);

  if (videoInfo?.platform === 'YouTube') {
    // YouTube has multiple thumbnail sizes
    const qualities = [
      { name: 'Max Resolution', suffix: 'maxresdefault' },
      { name: 'High Quality', suffix: 'hqdefault' },
      { name: 'Medium Quality', suffix: 'mqdefault' },
      { name: 'Standard', suffix: 'sddefault' },
      { name: 'Default', suffix: 'default' }
    ];

    // Convention: label = URL displayed, value = identifier
    for (const quality of qualities) {
      const thumbUrl = `https://img.youtube.com/vi/${videoInfo.videoId}/${quality.suffix}.jpg`;
      const thumbId = generateId();

      entities.push({
        id: thumbId,
        type: 'media_url',
        value: `${quality.name} Thumbnail`, // Identifier
        label: thumbUrl, // Displayed: the URL
        metadata: {
          quality: quality.name,
          videoId: videoInfo.videoId,
          platform: 'YouTube'
        },
        source: 'video-thumbnail',
        timestamp: new Date().toISOString()
      });

      edges.push({
        id: generateEdgeId(),
        sourceId: entity.id,
        targetId: thumbId,
        label: 'thumbnail',
        relationship: 'contains'
      });
    }
  } else if (videoInfo?.thumbnailUrl) {
    const thumbId = generateId();
    entities.push({
      id: thumbId,
      type: 'media_url',
      value: 'Video Thumbnail', // Identifier
      label: videoInfo.thumbnailUrl, // Displayed: the URL
      metadata: {
        platform: videoInfo.platform,
        videoId: videoInfo.videoId
      },
      source: 'video-thumbnail',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: thumbId,
      label: 'thumbnail',
      relationship: 'contains'
    });
  } else {
    const noteId = generateId();
    entities.push({
      id: noteId,
      type: 'note',
      value: 'No Thumbnails', // Identifier
      label: 'Thumbnails not available for this video source', // Displayed
      metadata: { videoUrl },
      source: 'video-thumbnail',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: noteId,
      label: 'status',
      relationship: 'related_to'
    });
  }

  return {
    success: true,
    entities,
    edges,
    message: `Extracted ${entities.length} thumbnails`,
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Find Related Videos
// ============================================

async function findRelated(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity } = input;
  const videoUrl = entity.value;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  const videoInfo = detectVideoPlatform(videoUrl);

  // Create search URLs for finding related content
  const searchUrls = [];

  if (videoInfo) {
    // Platform-specific related video search
    if (videoInfo.platform === 'YouTube') {
      searchUrls.push({
        name: 'YouTube Related',
        url: `https://www.youtube.com/watch?v=${videoInfo.videoId}`,
        description: 'View video page to see related videos'
      });
    }

    // Search for video on other platforms
    const videoTitle = entity.metadata?.title as string;
    if (videoTitle) {
      const encodedTitle = encodeURIComponent(videoTitle);
      searchUrls.push(
        {
          name: 'Search on Google',
          url: `https://www.google.com/search?q=${encodedTitle}+video`,
          description: 'Search for this video on Google'
        },
        {
          name: 'Search on YouTube',
          url: `https://www.youtube.com/results?search_query=${encodedTitle}`,
          description: 'Search for similar videos on YouTube'
        }
      );
    }
  }

  for (const search of searchUrls) {
    const urlId = generateId();
    entities.push({
      id: urlId,
      type: 'url',
      value: search.url,
      label: search.name,
      metadata: {
        purpose: search.description,
        sourceVideo: videoUrl
      },
      source: 'video-related',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: urlId,
      label: 'search',
      relationship: 'related_to'
    });
  }

  return {
    success: true,
    entities,
    edges,
    message: `Generated ${searchUrls.length} search links`,
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Plugin Executor
// ============================================

export const videoPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'video-metadata':
        return extractMetadata(input);

      case 'video-thumbnails':
        return extractThumbnails(input);

      case 'video-related':
        return findRelated(input);

      default:
        return {
          success: false,
          entities: [],
          edges: [],
          error: `Unknown transform: ${transformId}`
        };
    }
  }
};
