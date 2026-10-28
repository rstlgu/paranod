/**
 * Dialog for installing external plugins via manifest URL
 */

'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  IconAlertCircle,
  IconCheck,
  IconPuzzle,
  IconInfoCircle
} from '@tabler/icons-react';
import { toast } from 'sonner';
import { Separator } from '@/components/ui/separator';
import type { ManifestPreviewResponse } from '@/types/addons';

interface InstallAddonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function InstallAddonDialog({
  open,
  onOpenChange,
  onSuccess
}: InstallAddonDialogProps) {
  const [step, setStep] = useState<'url' | 'preview' | 'success'>('url');
  const [manifestUrl, setManifestUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installedPlugin, setInstalledPlugin] = useState<any>(null);
  const [preview, setPreview] = useState<
    ManifestPreviewResponse['preview'] | null
  >(null);

  function resetState() {
    setStep('url');
    setManifestUrl('');
    setError(null);
    setLoading(false);
    setIsPreviewLoading(false);
    setInstalledPlugin(null);
    setPreview(null);
  }

  async function handlePreview(nextManifestUrl?: string) {
    setIsPreviewLoading(true);
    setError(null);

    try {
      const manifestUrlToLoad = nextManifestUrl ?? manifestUrl;
      const response = await fetch('/api/addons/manifest/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestUrl: manifestUrlToLoad })
      });

      const data = (await response.json()) as ManifestPreviewResponse;

      if (!response.ok) {
        const details = Array.isArray(data.details)
          ? data.details.join('\n')
          : '';
        throw new Error(details || data.error || 'Unable to read the manifest');
      }

      if (!data.preview)
        throw new Error('Manifest valid but without preview data');

      setPreview(data.preview);
      setStep('preview');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to read the manifest'
      );
    } finally {
      setIsPreviewLoading(false);
    }
  }

  const handleInstall = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/addons/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifestUrl })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Installation failed');
      }

      setInstalledPlugin(data.addon);
      setStep('success');

      toast.success('Addon installed successfully!', {
        description: `${data.addon.name} v${data.addon.version}`
      });

      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
      toast.error('Installation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    resetState();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetState();
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className='sm:max-w-[600px]'>
        {step === 'url' && (
          <>
            <DialogHeader>
              <DialogTitle className='flex items-center gap-2'>
                <IconPuzzle className='h-5 w-5' />
                Install addon
              </DialogTitle>
              <DialogDescription>
                Insert the `manifest.json` URL.
              </DialogDescription>
            </DialogHeader>

            <Separator />
          </>
        )}

        {step === 'url' ? (
          <>
            <div className='space-y-4 py-4'>
              <div className='space-y-2'>
                <Label htmlFor='manifest-url'>URL manifest</Label>
                <Input
                  id='manifest-url'
                  placeholder='https://cdn.example.com/plugin/manifest.json'
                  value={manifestUrl}
                  onChange={(e) => setManifestUrl(e.target.value)}
                  disabled={isPreviewLoading || loading}
                />
                <p className='text-muted-foreground flex items-start gap-1.5 text-xs'>
                  <IconInfoCircle className='mt-0.5 h-3.5 w-3.5 shrink-0' />
                  <span>
                    Use the personalized HTTPS manifest URL provided by the
                    addon. Treat it as a secret.
                  </span>
                </p>
              </div>

              {error && (
                <Alert variant='destructive'>
                  <IconAlertCircle className='h-4 w-4' />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
            </div>

            <DialogFooter>
              <Button variant='outline' onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={() => void handlePreview()}
                disabled={!manifestUrl || isPreviewLoading || loading}
              >
                {isPreviewLoading ? (
                  <>Loading…</>
                ) : (
                  <>
                    <IconCheck className='h-4 w-4' />
                    Review addon
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : step === 'preview' ? (
          <>
            <div className='space-y-4 py-4'>
              {error && (
                <Alert variant='destructive'>
                  <IconAlertCircle className='h-4 w-4' />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {preview && (
                <div className='space-y-4'>
                  <div className='flex items-start gap-4'>
                    <div className='bg-muted flex h-12 w-12 shrink-0 items-center justify-center rounded-md border'>
                      <IconPuzzle className='text-muted-foreground h-6 w-6' />
                    </div>

                    <div className='min-w-0 flex-1'>
                      <div className='flex items-center gap-2'>
                        <div className='min-w-0 text-base leading-none font-semibold'>
                          {preview.name}
                        </div>
                        <div className='text-muted-foreground shrink-0 text-sm'>
                          v{preview.version}
                        </div>
                      </div>

                      <p className='text-muted-foreground mt-2 text-sm'>
                        {preview.description}
                      </p>

                      <p className='text-muted-foreground mt-3 text-xs'>
                        Author: {preview.author} · Transforms:{' '}
                        {preview.transformsCount}
                        {preview.supportsAsync ? ' · Async jobs' : ''}
                      </p>
                    </div>
                  </div>

                  <Alert>
                    <IconAlertCircle className='h-4 w-4' />
                    <AlertDescription>
                      This addon is operated outside Paranod. Selected entity
                      data will be sent to its servers. Install it only if you
                      trust the provider.
                    </AlertDescription>
                  </Alert>

                  <div className='text-muted-foreground space-y-1 text-xs'>
                    <div className='text-foreground font-medium'>
                      Data destinations
                    </div>
                    {preview.endpointOrigins.map((origin) => (
                      <div key={origin} className='font-mono break-all'>
                        {origin}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant='outline'
                onClick={handleClose}
                disabled={loading}
              >
                Cancel
              </Button>
              <Button onClick={handleInstall} disabled={loading}>
                {loading ? (
                  <>Installation…</>
                ) : (
                  <>
                    <IconCheck className='h-4 w-4' />
                    Install
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <div className='space-y-4 py-4'>
              <Alert>
                <IconCheck className='h-4 w-4' />
                <AlertDescription>
                  Addon <strong>{installedPlugin?.name}</strong> installed
                  successfully!
                </AlertDescription>
              </Alert>
            </div>

            <DialogFooter>
              <Button onClick={handleClose} className='w-full'>
                Done
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
