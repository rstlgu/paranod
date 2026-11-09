/**
 * Image Analysis Plugin
 * Provides image analysis transforms (EXIF, OCR, reverse search)
 */

import sharp from 'sharp';
import exifr from 'exifr';
import { loadImageBytes } from '@/lib/security/image-bytes';
import { safePublicFetch } from '@/lib/security/safe-fetch';

import type {
  PluginExecutor,
  PluginExecutionContext,
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge
} from '../types';

// ============================================
// Helper Functions
// ============================================

function generateId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// EXIF is extracted from file bytes, never from caller-provided entity metadata.
async function extractExif(
  input: TransformInput,
  context?: PluginExecutionContext
): Promise<TransformResult> {
  const bytes = await loadImageBytes(input.entity.value, context);
  const info = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
  if (
    !['jpeg', 'png', 'webp', 'tiff', 'heif', 'avif'].includes(info.format || '')
  )
    throw new Error('Unsupported image format');
  const tags =
    (await exifr.parse(bytes, {
      xmp: false,
      icc: false,
      iptc: false,
      makerNote: false,
      userComment: false,
      pick: [
        'Make',
        'Model',
        'DateTimeOriginal',
        'Software',
        'Orientation',
        'GPSLatitude',
        'GPSLongitude',
        'GPSLatitudeRef',
        'GPSLongitudeRef'
      ]
    })) || {};
  const metadata = JSON.parse(
    JSON.stringify({
      format: info.format,
      width: info.width,
      height: info.height,
      ...tags
    })
  );
  const noteId = generateId();
  const entities: OSINTEntity[] = [
    {
      id: noteId,
      type: 'note',
      value: JSON.stringify(metadata, null, 2),
      label: 'Image metadata',
      metadata: { ...metadata, independentlyVerified: false },
      source: 'image-exif',
      timestamp: new Date().toISOString()
    }
  ];
  const edges: OSINTEdge[] = [
    {
      id: generateEdgeId(),
      sourceId: input.entity.id,
      targetId: noteId,
      label: 'image metadata',
      relationship: 'contains'
    }
  ];
  if (
    Number.isFinite(tags.latitude) &&
    Number.isFinite(tags.longitude) &&
    Math.abs(tags.latitude) <= 90 &&
    Math.abs(tags.longitude) <= 180
  ) {
    const id = generateId();
    entities.push({
      id,
      type: 'location',
      value: `${tags.latitude}, ${tags.longitude}`,
      label: 'EXIF coordinates (unverified)',
      metadata: {
        latitude: tags.latitude,
        longitude: tags.longitude,
        independentlyVerified: false
      },
      source: 'image-exif',
      timestamp: new Date().toISOString()
    });
    edges.push({
      id: generateEdgeId(),
      sourceId: input.entity.id,
      targetId: id,
      label: 'declared GPS',
      relationship: 'contains'
    });
  }
  return {
    success: true,
    entities,
    edges,
    message: info.exif
      ? 'Embedded metadata extracted; authenticity not verified'
      : 'Image properties extracted; no EXIF block present'
  };
}

// ============================================
// Reverse Image Search
// ============================================

async function reverseImageSearch(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity, config } = input;
  const imageUrl = entity.value;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  // Generate search URLs for various reverse image search engines
  const encodedUrl = encodeURIComponent(imageUrl);

  const searchEngines = [
    {
      name: 'Google Images',
      url: `https://lens.google.com/uploadbyurl?url=${encodedUrl}`,
      icon: 'google'
    },
    {
      name: 'TinEye',
      url: `https://tineye.com/search?url=${encodedUrl}`,
      icon: 'tineye'
    },
    {
      name: 'Yandex Images',
      url: `https://yandex.com/images/search?rpt=imageview&url=${encodedUrl}`,
      icon: 'yandex'
    },
    {
      name: 'Bing Visual Search',
      url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&q=imgurl:${encodedUrl}`,
      icon: 'bing'
    }
  ];

  // Create URL nodes for each search engine
  // Convention: label = URL displayed, value = identifier
  for (const engine of searchEngines) {
    const urlId = generateId();
    entities.push({
      id: urlId,
      type: 'url',
      value: engine.url, // Usable by downstream URL transforms
      label: engine.url, // Displayed: the actual URL
      metadata: {
        searchEngine: engine.name,
        originalImage: imageUrl,
        purpose: 'Reverse Image Search'
      },
      source: 'reverse-image-search',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: urlId,
      label: `search on ${engine.name}`,
      relationship: 'related_to'
    });
  }

  return {
    success: true,
    entities,
    edges,
    message: `Generated ${searchEngines.length} reverse image search links`,
    executionTime: Date.now() - startTime
  };
}

async function extractText(
  input: TransformInput,
  context?: PluginExecutionContext
): Promise<TransformResult> {
  const apiKey = input.config?.ocrApiKey;
  if (typeof apiKey !== 'string' || !apiKey.trim())
    throw new Error('Configure a Google Cloud Vision API key to use OCR');
  const bytes = await loadImageBytes(input.entity.value, context);
  const response = await safePublicFetch(
    'https://vision.googleapis.com/v1/images:annotate',
    {
      method: 'POST',
      redirect: 'error',
      timeoutMs: 30000,
      maxBytes: 2_000_000,
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey },
      body: JSON.stringify({
        requests: [
          {
            image: { content: bytes.toString('base64') },
            features: [{ type: 'TEXT_DETECTION' }]
          }
        ]
      })
    }
  );
  if (!response.ok)
    throw new Error('OCR provider returned HTTP ' + response.status);
  const data = await response.json();
  const result = data.responses?.[0];
  if (!result || result.error)
    throw new Error('OCR provider could not process this image');
  const text =
    result.fullTextAnnotation?.text ??
    result.textAnnotations?.[0]?.description ??
    '';
  if (typeof text !== 'string' || text.length > 128000)
    throw new Error('Invalid or excessive OCR result');
  if (!text.trim())
    return {
      success: true,
      entities: [],
      edges: [],
      message: 'No text detected'
    };
  const id = generateId();
  return {
    success: true,
    entities: [
      {
        id,
        type: 'note',
        value: text,
        label: 'Extracted text (OCR)',
        metadata: {
          provider: 'Google Cloud Vision',
          independentlyVerified: false
        },
        source: 'image-ocr',
        timestamp: new Date().toISOString()
      }
    ],
    edges: [
      {
        id: generateEdgeId(),
        sourceId: input.entity.id,
        targetId: id,
        label: 'detected text',
        relationship: 'contains'
      }
    ],
    message: 'Text extracted by Google Cloud Vision'
  };
}

async function generateImageHash(
  input: TransformInput,
  context?: PluginExecutionContext
): Promise<TransformResult> {
  const bytes = await loadImageBytes(input.entity.value, context);
  const pixels = await sharp(bytes, { limitInputPixels: 40_000_000 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(32, 32, { fit: 'fill' })
    .greyscale()
    .raw()
    .timeout({ seconds: 10 })
    .toBuffer();
  // 2D DCT, top-left 8x8 coefficients; median excludes the DC component.
  const coefficients: number[] = [];
  for (let v = 0; v < 8; v++)
    for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          sum +=
            pixels[y * 32 + x] *
            Math.cos(((2 * x + 1) * u * Math.PI) / 64) *
            Math.cos(((2 * y + 1) * v * Math.PI) / 64);
        }
      coefficients.push(Math.abs(sum) < 1e-7 ? 0 : sum);
    }
  const sorted = coefficients.slice(1).sort((a, b) => a - b);
  const median = sorted[31];
  const bits = coefficients
    .map((c, i) => (i > 0 && c > median ? '1' : '0'))
    .join('');
  const hash = BigInt('0b' + bits)
    .toString(16)
    .padStart(16, '0');
  const id = generateId();
  return {
    success: true,
    entities: [
      {
        id,
        type: 'hash',
        value: hash,
        label: hash,
        metadata: {
          algorithm: 'pHash-DCT-32-v1',
          bits: 64,
          dcBit: 0,
          usage: 'Similarity only; not cryptographic evidence'
        },
        source: 'image-hash',
        timestamp: new Date().toISOString()
      }
    ],
    edges: [
      {
        id: generateEdgeId(),
        sourceId: input.entity.id,
        targetId: id,
        label: 'perceptual hash',
        relationship: 'contains'
      }
    ],
    message: 'Perceptual hash computed from decoded image pixels'
  };
}

// ============================================
// Plugin Executor
// ============================================

export const imagePluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput,
    _onProgress,
    context
  ): Promise<TransformResult> {
    try {
      switch (transformId) {
        case 'image-exif':
          return await extractExif(input, context);

        case 'image-reverse-search':
          return reverseImageSearch(input);

        case 'image-ocr':
          return await extractText(input, context);

        case 'image-hash':
          return await generateImageHash(input, context);

        default:
          return {
            success: false,
            entities: [],
            edges: [],
            error: `Unknown transform: ${transformId}`
          };
      }
    } catch (error) {
      return {
        success: false,
        entities: [],
        edges: [],
        error:
          error instanceof Error ? error.message : 'Image processing failed'
      };
    }
  }
};
