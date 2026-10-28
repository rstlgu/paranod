/**
 * API Route: Install Addon
 * POST /api/addons/install
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { ManifestValidator } from '@/lib/validators/manifest-validator';
import { getActiveWorkspaceAccess } from '@/lib/auth-utils';
import { safeFetch } from '@/lib/security/safe-fetch';
import {
  createAddonRequestHeaders,
  getAddonInstallToken,
  redactAddonUrl
} from '@/lib/security/addon-request';
import { decryptSecret, encryptSecret } from '@/lib/security/secrets';
import { buildAppUrl } from '@/lib/url';
import { serializeStoredAddonManifest } from '@/features/plugins/addon-storage';
import { getPlugin } from '@/features/plugins/registry';
import type { InstallAddonRequest, InstallAddonResponse } from '@/types/addons';
import { readBoundedBody } from '@/lib/security/bounded-body';

export async function POST(request: NextRequest) {
  try {
    const access = await getActiveWorkspaceAccess();
    if (!access) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }
    if (access.role !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'Only admins can install addons' },
        { status: 403 }
      );
    }
    const { workspaceId } = access;

    const body = JSON.parse(
      await readBoundedBody(request, 64 * 1024)
    ) as InstallAddonRequest;
    const { manifestUrl } = body;

    // Validate input
    if (!manifestUrl || typeof manifestUrl !== 'string') {
      return NextResponse.json(
        { success: false, error: 'manifestUrl is required' },
        { status: 400 }
      );
    }

    let installToken: string;
    try {
      installToken = getAddonInstallToken(manifestUrl);
    } catch (error) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid personalized manifest URL',
          details: [error instanceof Error ? error.message : 'Missing token']
        },
        { status: 400 }
      );
    }

    console.log(`📦 Installing addon from: ${redactAddonUrl(manifestUrl)}`);

    // 1. Fetch and validate manifest
    const validation = await ManifestValidator.fetchAndValidate(manifestUrl);

    if (!validation.valid || !validation.manifest) {
      console.error('❌ Manifest validation failed:', validation.errors);
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid manifest',
          details: validation.errors
        },
        { status: 400 }
      );
    }

    const manifest = validation.manifest;
    console.log(
      `✅ Manifest validated: ${manifest.plugin.name} v${manifest.plugin.version}`
    );

    const conflictingCustomPlugin = await db.customPlugin.findUnique({
      where: { id: manifest.plugin.id },
      select: { id: true }
    });
    if (getPlugin(manifest.plugin.id) || conflictingCustomPlugin) {
      return NextResponse.json(
        {
          success: false,
          error: 'Addon ID conflicts with an existing plugin'
        },
        { status: 409 }
      );
    }

    // 2. Verify all transform endpoints (HTTPS + SSRF guard)
    console.log('🔒 Verifying transform endpoints...');
    const endpointValidation =
      await ManifestValidator.validateAllEndpoints(manifest);

    if (!endpointValidation.valid) {
      console.error(
        '❌ Endpoint validation failed:',
        endpointValidation.errors
      );
      return NextResponse.json(
        {
          success: false,
          error: 'Unsafe or invalid transform endpoints',
          details: endpointValidation.errors
        },
        { status: 400 }
      );
    }

    console.log('✅ All endpoints passed validation');

    // 3. Check if addon already installed
    const existing = await db.workspaceAddonInstall.findUnique({
      where: {
        workspaceId_addonId: {
          workspaceId: workspaceId,
          addonId: manifest.plugin.id
        }
      }
    });
    if (existing) {
      const activeJobs = await db.transformJob.count({
        where: {
          workspaceId,
          addonId: manifest.plugin.id,
          status: { in: ['PENDING', 'SUBMITTED', 'PROCESSING'] }
        }
      });
      if (activeJobs > 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Addon has active jobs and cannot be reinstalled'
          },
          { status: 409 }
        );
      }
    }

    // 4. Get workspace details
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { name: true }
    });

    // 5. Register workspace with addon (multi-tenant support)
    console.log('📝 Registering workspace with addon...');

    // Determine registration endpoint from manifest URL
    const manifestUrlObj = new URL(manifestUrl);
    const registerEndpoint = new URL('register', manifestUrlObj)
      .toString()
      .split('?')[0];

    console.log(`   Endpoint: ${redactAddonUrl(registerEndpoint)}`);
    console.log(
      `   Workspace: ${workspaceId} (${workspace?.name || 'Unknown'})`
    );

    let webhookSecret: string;

    try {
      const platformUrl = buildAppUrl('/');
      const registrationBody = JSON.stringify({
        workspaceId,
        workspaceName: workspace?.name,
        platformUrl,
        platformVersion: '2.0.0'
      });

      const registerResponse = await safeFetch(registerEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${installToken}`,
          ...(existing
            ? createAddonRequestHeaders(
                registrationBody,
                workspaceId,
                decryptSecret(existing.webhookSecret)
              )
            : { 'Content-Type': 'application/json' })
        },
        body: registrationBody,
        timeoutMs: 10_000,
        maxResponseBytes: 128 * 1024
      });

      if (!registerResponse.ok) {
        throw new Error(
          `Addon registration failed with HTTP ${registerResponse.status}`
        );
      }

      const registerData = await registerResponse.json<{
        webhookSecret?: unknown;
      }>();
      const receivedSecret = registerData.webhookSecret;

      if (typeof receivedSecret !== 'string' || receivedSecret.length < 32) {
        throw new Error('Addon did not return webhookSecret');
      }
      webhookSecret = receivedSecret;

      console.log(`✅ Workspace registered with addon`);
    } catch (error) {
      console.error('❌ Addon registration failed.');

      // If registration fails, don't install the addon
      return NextResponse.json(
        {
          success: false,
          error: 'Addon registration failed',
          details: [
            'Failed to register with addon server',
            'The addon must implement POST /register endpoint for multi-tenant support'
          ]
        },
        { status: 502 }
      );
    }

    // 6. Save to database
    const storedData = {
      manifestUrl: encryptSecret(manifestUrl),
      manifestVersion: manifest.manifestVersion,
      manifestData: serializeStoredAddonManifest(manifest),
      webhookSecret: encryptSecret(webhookSecret),
      enabled: true,
      uninstalledAt: null
    };
    const addon = existing
      ? await db.workspaceAddonInstall.update({
          where: {
            workspaceId_addonId: {
              workspaceId,
              addonId: manifest.plugin.id
            }
          },
          data: storedData
        })
      : await db.workspaceAddonInstall.create({
          data: {
            workspaceId,
            addonId: manifest.plugin.id,
            ...storedData
          }
        });

    console.log(`✅ Addon installed successfully: ${addon.id}`);

    // 7. Return only non-sensitive installation metadata
    const response: InstallAddonResponse = {
      success: true,
      addon: {
        id: addon.id,
        addonId: addon.addonId,
        name: manifest.plugin.name,
        version: manifest.plugin.version,
        installedAt: addon.installedAt
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof RangeError)
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    console.error('❌ Addon installation failed.');
    return NextResponse.json(
      {
        success: false,
        error: 'Internal server error'
      },
      { status: 500 }
    );
  }
}
