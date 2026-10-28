/**
 * API Route per Social Media Transform
 * POST /api/transforms/social
 */

import { NextRequest, NextResponse } from 'next/server';
import type { TransformInput, TransformResult } from '@/features/plugins/types';
import {
  extractPlatformInfo,
  generateSearchLinks
} from '@/features/plugins/builtin/social-plugin';
import { withTransformGate } from '@/features/plugins/route-handler';

export async function POST(request: NextRequest) {
  return withTransformGate('social-media', request, async () => {
    try {
      const body = await request.json();
      const { transformId, input } = body as {
        transformId: string;
        input: TransformInput;
      };

      let result: TransformResult;

      switch (transformId) {
        case 'social-extract-info':
          result = await extractPlatformInfo(input);
          break;

        case 'social-generate-url':
          result = await generateSearchLinks(input);
          break;

        case 'social-search':
          // Generate search URLs for the profile
          const username = input.entity.value;
          const entities = [];
          const edges = [];

          // Google search
          const googleId = `entity-${Date.now()}-1`;
          entities.push({
            id: googleId,
            type: 'url' as const,
            value: `https://www.google.com/search?q="${username}"`,
            label: `Google: "${username}"`,
            metadata: { searchEngine: 'Google' },
            timestamp: new Date().toISOString()
          });
          edges.push({
            id: `edge-${Date.now()}-1`,
            sourceId: input.entity.id,
            targetId: googleId,
            label: 'search',
            relationship: 'related_to' as const
          });

          // DuckDuckGo search
          const ddgId = `entity-${Date.now()}-2`;
          entities.push({
            id: ddgId,
            type: 'url' as const,
            value: `https://duckduckgo.com/?q="${username}"`,
            label: `DuckDuckGo: "${username}"`,
            metadata: { searchEngine: 'DuckDuckGo' },
            timestamp: new Date().toISOString()
          });
          edges.push({
            id: `edge-${Date.now()}-2`,
            sourceId: input.entity.id,
            targetId: ddgId,
            label: 'search',
            relationship: 'related_to' as const
          });

          result = {
            success: true,
            entities,
            edges,
            message: 'Generated search links'
          };
          break;

        default:
          return NextResponse.json(
            {
              success: false,
              data: {
                success: false,
                entities: [],
                edges: [],
                error: `Unknown transform: ${transformId}`
              }
            },
            { status: 400 }
          );
      }

      return NextResponse.json({ success: true, data: result });
    } catch (error) {
      console.error('Social transform error:', error);
      return NextResponse.json(
        {
          success: false,
          data: {
            success: false,
            entities: [],
            edges: [],
            error: error instanceof Error ? error.message : 'Transform failed'
          }
        },
        { status: 500 }
      );
    }
  });
}
