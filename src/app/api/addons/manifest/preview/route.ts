/**
 * API Route: Preview Addon Manifest
 * POST /api/addons/manifest/preview
 */

import { NextRequest, NextResponse } from 'next/server';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { ManifestValidator } from '@/lib/validators/manifest-validator';
import { getAddonInstallToken } from '@/lib/security/addon-request';
import type {
  ManifestPreviewRequest,
  ManifestPreviewResponse
} from '@/types/addons';

const MAX_PREVIEW_REQUEST_BYTES = 16 * 1024;

export async function POST(request: NextRequest) {
  try {
    const access = await getActiveWorkspaceAccess();
    if (!access) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized'
        } satisfies ManifestPreviewResponse,
        { status: 401 }
      );
    }
    if (access.role !== 'admin') {
      return NextResponse.json(
        {
          success: false,
          error: 'Only admins can preview addon installations'
        } satisfies ManifestPreviewResponse,
        { status: 403 }
      );
    }

    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_PREVIEW_REQUEST_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: 'Payload too large'
        } satisfies ManifestPreviewResponse,
        { status: 413 }
      );
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_PREVIEW_REQUEST_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: 'Payload too large'
        } satisfies ManifestPreviewResponse,
        { status: 413 }
      );
    }
    let body: ManifestPreviewRequest;
    try {
      body = JSON.parse(rawBody) as ManifestPreviewRequest;
    } catch {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid JSON payload'
        } satisfies ManifestPreviewResponse,
        { status: 400 }
      );
    }
    const { manifestUrl } = body;

    if (!manifestUrl || typeof manifestUrl !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'manifestUrl is required'
        } satisfies ManifestPreviewResponse,
        { status: 400 }
      );
    }

    try {
      getAddonInstallToken(manifestUrl);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid personalized manifest URL',
          details: [error instanceof Error ? error.message : 'Missing token']
        } satisfies ManifestPreviewResponse,
        { status: 400 }
      );
    }

    const validation = await ManifestValidator.fetchAndValidate(manifestUrl);
    if (!validation.valid || !validation.manifest) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid manifest',
          details: validation.errors
        } satisfies ManifestPreviewResponse,
        { status: 400 }
      );
    }

    const manifest = validation.manifest;
    const endpointValidation =
      await ManifestValidator.validateAllEndpoints(manifest);
    if (!endpointValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unsafe or invalid transform endpoints',
          details: endpointValidation.errors
        } satisfies ManifestPreviewResponse,
        { status: 400 }
      );
    }
    const endpointOrigins = Array.from(
      new Set([
        new URL(manifestUrl).origin,
        ...manifest.plugin.transforms.map(
          (transform) => new URL(transform.endpoint).origin
        )
      ])
    );
    const response: ManifestPreviewResponse = {
      success: true,
      preview: {
        addonId: manifest.plugin.id,
        name: manifest.plugin.name,
        description: manifest.plugin.description,
        version: manifest.plugin.version,
        author: manifest.plugin.author,
        authorUrl: manifest.plugin.authorUrl,
        transformsCount: manifest.plugin.transforms.length,
        endpointOrigins,
        supportsAsync: manifest.plugin.capabilities.supportsAsync
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error',
        details: [error instanceof Error ? error.message : 'Unknown error']
      } satisfies ManifestPreviewResponse,
      { status: 500 }
    );
  }
}
