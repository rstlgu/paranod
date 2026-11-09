'use client';

import { toast } from 'sonner';
import { toJpeg, toPng } from 'html-to-image';
import type { Edge, Node, ReactFlowInstance } from 'reactflow';

function getIsoDateSlug() {
  return new Date().toISOString().slice(0, 10);
}

async function blobToDataUrl(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read blob as data URL'));
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(blob);
  });
  if (!dataUrl.startsWith('data:')) throw new Error('Invalid data URL');
  return dataUrl;
}

function getSameOriginUrl(value: string) {
  try {
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin) return null;
    return url;
  } catch {
    return null;
  }
}

async function inlineSameOriginImagesForCapture(args: { rootEl: HTMLElement }) {
  const images = Array.from(args.rootEl.querySelectorAll('img')) as HTMLImageElement[];
  const originals = new Map<
    HTMLImageElement,
    { src: string; srcset: string; sizes: string }
  >();

  const candidates = images.filter((img) => {
    const src = img.currentSrc || img.src;
    if (!src) return false;
    if (src.startsWith('data:')) return false;
    if (src.startsWith('blob:')) return false;
    const url = getSameOriginUrl(src);
    if (!url) return false;
    // We inline same-origin images to avoid html-to-image caching collisions on querystring URLs
    // (notably /api/logo?... and /_next/image?...).
    return true;
  });

  await Promise.all(
    candidates.map(async (img) => {
      const src = img.currentSrc || img.src;
      const url = getSameOriginUrl(src);
      if (!url) return;

      originals.set(img, {
        src: img.getAttribute('src') ?? '',
        srcset: img.getAttribute('srcset') ?? '',
        sizes: img.getAttribute('sizes') ?? ''
      });

      try {
        const res = await fetch(url.toString(), { cache: 'no-store', credentials: 'same-origin' });
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);

        // Ensure the browser doesn't pick a different resource via srcset/sizes.
        img.setAttribute('srcset', '');
        img.setAttribute('sizes', '');
        img.src = dataUrl;

        // Best-effort: wait for decode to ensure render is updated before capture.
        await img.decode().catch(() => undefined);
      } catch {
        // Ignore individual failures; capture should still proceed.
      }
    })
  );

  function restore() {
    originals.forEach((value, img) => {
      img.setAttribute('src', value.src);
      img.setAttribute('srcset', value.srcset);
      img.setAttribute('sizes', value.sizes);
    });
  }

  return { restore };
}

function downloadBlob(args: { blob: Blob; filename: string }) {
  const url = URL.createObjectURL(args.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = args.filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(args: { dataUrl: string; filename: string }) {
  const a = document.createElement('a');
  a.href = args.dataUrl;
  a.download = args.filename;
  a.click();
}

function getReactFlowEl(args: { reactFlowRootEl: HTMLDivElement }) {
  const el = args.reactFlowRootEl.querySelector('.react-flow') as HTMLElement | null;
  if (!el) throw new Error('React Flow not found');
  return el;
}

function prepareReactFlowForCapture(args: { reactFlowEl: HTMLElement }) {
  const { reactFlowEl } = args;

  // Hide background pattern
  const background = reactFlowEl.querySelector('.react-flow__background') as HTMLElement | null;
  const originalBgDisplay = background?.style.display ?? '';
  if (background) background.style.display = 'none';

  // Hide all buttons in node headers (X and collapse buttons)
  const nodeButtons = reactFlowEl.querySelectorAll('.react-flow__node button');
  const originalButtonDisplays = new Map<HTMLElement, string>();
  nodeButtons.forEach((btn) => {
    const htmlBtn = btn as HTMLElement;
    originalButtonDisplays.set(htmlBtn, htmlBtn.style.display || '');
    htmlBtn.style.display = 'none';
  });

  // Hide scrollbars - aggressive
  const originalOverflowByEl = new Map<
    HTMLElement,
    { overflow: string; overflowX: string; overflowY: string }
  >();
  const allElements = reactFlowEl.querySelectorAll('*');
  allElements.forEach((el) => {
    const htmlEl = el as HTMLElement;
    const computed = window.getComputedStyle(htmlEl);
    const shouldTouchOverflow =
      computed.overflow !== 'visible' && computed.overflow !== 'hidden';
    const shouldTouchOverflowX = computed.overflowX === 'auto' || computed.overflowX === 'scroll';
    const shouldTouchOverflowY = computed.overflowY === 'auto' || computed.overflowY === 'scroll';

    if (!shouldTouchOverflow && !shouldTouchOverflowX && !shouldTouchOverflowY) return;

    if (!originalOverflowByEl.has(htmlEl)) {
      originalOverflowByEl.set(htmlEl, {
        overflow: htmlEl.style.overflow || '',
        overflowX: htmlEl.style.overflowX || '',
        overflowY: htmlEl.style.overflowY || ''
      });
    }

    if (shouldTouchOverflow) htmlEl.style.overflow = 'hidden';
    if (shouldTouchOverflowX) htmlEl.style.overflowX = 'hidden';
    if (shouldTouchOverflowY) htmlEl.style.overflowY = 'hidden';
  });

  function restore() {
    if (background) background.style.display = originalBgDisplay;
    originalButtonDisplays.forEach((value, element) => {
      element.style.display = value;
    });
    originalOverflowByEl.forEach((value, element) => {
      element.style.overflow = value.overflow;
      element.style.overflowX = value.overflowX;
      element.style.overflowY = value.overflowY;
    });
  }

  return { restore };
}

export function exportGraphJson(args: { nodes: Node[]; edges: Edge[] }) {
  const json = JSON.stringify({ nodes: args.nodes, edges: args.edges }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  downloadBlob({ blob, filename: `osint-graph-${getIsoDateSlug()}.json` });
  toast.success('Graph exported');
}

export async function exportGraphPng(args: {
  reactFlowRootEl: HTMLDivElement;
  reactFlowInstance: ReactFlowInstance;
  isDark: boolean;
  pixelRatio: number;
  filename: string;
  toastLabel: string;
}) {
  const loadingToast = toast.loading(args.toastLabel);

  try {
    const reactFlowEl = getReactFlowEl({ reactFlowRootEl: args.reactFlowRootEl });
    const { restore } = prepareReactFlowForCapture({ reactFlowEl });

    // Fit view with extra padding to ensure nothing is cut off
    await args.reactFlowInstance.fitView({
      padding: 0.2,
      duration: 0,
      maxZoom: 1.5
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const { restore: restoreImages } = await inlineSameOriginImagesForCapture({ rootEl: reactFlowEl });

    const dataUrl = await toPng(reactFlowEl, {
      backgroundColor: args.isDark ? '#09090b' : '#ffffff',
      pixelRatio: args.pixelRatio,
      cacheBust: true,
      filter: (node) => {
        if ((node as Element).classList?.contains('react-flow__controls')) return false;
        if ((node as Element).classList?.contains('react-flow__minimap')) return false;
        if ((node as Element).classList?.contains('react-flow__panel')) return false;
        if ((node as Element).classList?.contains('react-flow__background')) return false;
        return true;
      }
    });

    restoreImages();
    restore();

    downloadDataUrl({ dataUrl, filename: args.filename });
    toast.dismiss(loadingToast);
    toast.success('PNG exported');
  } catch (error) {
    toast.dismiss(loadingToast);
    toast.error('Failed to export PNG');
    console.error('PNG export error:', error);
  }
}

export async function exportGraphJpeg(args: {
  reactFlowRootEl: HTMLDivElement;
  reactFlowInstance: ReactFlowInstance;
  isDark: boolean;
  filename: string;
}) {
  const loadingToast = toast.loading('Generating JPEG...');

  try {
    const reactFlowEl = getReactFlowEl({ reactFlowRootEl: args.reactFlowRootEl });
    const { restore } = prepareReactFlowForCapture({ reactFlowEl });

    await args.reactFlowInstance.fitView({
      padding: 0.2,
      duration: 0,
      maxZoom: 1.5
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const { restore: restoreImages } = await inlineSameOriginImagesForCapture({ rootEl: reactFlowEl });

    const dataUrl = await toJpeg(reactFlowEl, {
      backgroundColor: args.isDark ? '#09090b' : '#ffffff',
      quality: 0.95,
      pixelRatio: 2,
      cacheBust: true,
      filter: (node) => {
        if ((node as Element).classList?.contains('react-flow__controls')) return false;
        if ((node as Element).classList?.contains('react-flow__minimap')) return false;
        if ((node as Element).classList?.contains('react-flow__panel')) return false;
        if ((node as Element).classList?.contains('react-flow__background')) return false;
        return true;
      }
    });

    restoreImages();
    restore();

    downloadDataUrl({ dataUrl, filename: args.filename });
    toast.dismiss(loadingToast);
    toast.success('JPEG exported');
  } catch (error) {
    toast.dismiss(loadingToast);
    toast.error('Failed to export JPEG');
    console.error('JPEG export error:', error);
  }
}

export async function exportGraphHtml(args: {
  reactFlowRootEl: HTMLDivElement;
  reactFlowInstance: ReactFlowInstance;
  isDark: boolean;
  graphName: string;
  graphDescription: string;
  filename: string;
}) {
  const loadingToast = toast.loading('Generating HTML...');

  try {
    const reactFlowEl = getReactFlowEl({ reactFlowRootEl: args.reactFlowRootEl });

    // Hide elements UI (solo background + buttons come prima)
    const background = reactFlowEl.querySelector('.react-flow__background') as HTMLElement | null;
    const originalBgDisplay = background?.style.display ?? '';
    if (background) background.style.display = 'none';

    const nodeButtons = reactFlowEl.querySelectorAll('.react-flow__node button');
    const originalButtonDisplays = new Map<HTMLElement, string>();
    nodeButtons.forEach((btn) => {
      const htmlBtn = btn as HTMLElement;
      originalButtonDisplays.set(htmlBtn, htmlBtn.style.display || '');
      htmlBtn.style.display = 'none';
    });

    await args.reactFlowInstance.fitView({
      padding: 0.2,
      duration: 0,
      maxZoom: 1.5
    });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const { restore: restoreImages } = await inlineSameOriginImagesForCapture({ rootEl: reactFlowEl });

    const dataUrl = await toPng(reactFlowEl, {
      backgroundColor: args.isDark ? '#09090b' : '#ffffff',
      pixelRatio: 3,
      cacheBust: true,
      filter: (node) => {
        if ((node as Element).classList?.contains('react-flow__controls')) return false;
        if ((node as Element).classList?.contains('react-flow__minimap')) return false;
        if ((node as Element).classList?.contains('react-flow__panel')) return false;
        if ((node as Element).classList?.contains('react-flow__background')) return false;
        return true;
      }
    });

    restoreImages();
    // restore
    if (background) background.style.display = originalBgDisplay;
    originalButtonDisplays.forEach((value, element) => {
      element.style.display = value;
    });

    const html = buildStandaloneHtml({
      dataUrl,
      isDark: args.isDark,
      graphName: args.graphName,
      graphDescription: args.graphDescription
    });

    const blob = new Blob([html], { type: 'text/html' });
    downloadBlob({ blob, filename: args.filename });

    toast.dismiss(loadingToast);
    toast.success('HTML exported');
  } catch (error) {
    toast.dismiss(loadingToast);
    toast.error('Failed to export HTML');
    console.error('HTML export error:', error);
  }
}

function buildStandaloneHtml(args: {
  dataUrl: string;
  isDark: boolean;
  graphName: string;
  graphDescription: string;
}) {
  const title = args.graphName || 'Untitled';
  const name = args.graphName || 'OSINT Graph';
  const description = args.graphDescription || 'No description available';

  return `<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OSINT Graph - ${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: ${args.isDark ? '#09090b' : '#ffffff'};
            color: ${args.isDark ? '#fafafa' : '#09090b'};
            overflow: hidden;
            width: 100vw;
            height: 100vh;
        }
        .header {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            padding: 1rem 2rem;
            background: ${args.isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(250, 250, 250, 0.95)'};
            backdrop-filter: blur(12px);
            border-bottom: 1px solid ${args.isDark ? '#27272a' : '#e4e4e7'};
            z-index: 10;
        }
        .header h1 {
            font-size: 1.5rem;
            font-weight: 700;
            letter-spacing: -0.025em;
            margin-bottom: 0.375rem;
        }
        .header .description {
            font-size: 0.875rem;
            color: ${args.isDark ? '#a1a1aa' : '#71717a'};
            font-weight: 400;
            line-height: 1.4;
        }
        .graph-container {
            width: 100vw;
            height: 100vh;
            position: relative;
            overflow: hidden;
            cursor: grab;
        }
        .graph-container.dragging { cursor: grabbing; }
        .graph-image {
            position: absolute;
            top: 50%;
            left: 50%;
            transform-origin: center center;
            user-select: none;
            -webkit-user-drag: none;
        }
        .zoom-control {
            position: fixed;
            bottom: 2rem;
            left: 2rem;
            background: ${args.isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(250, 250, 250, 0.95)'};
            backdrop-filter: blur(12px);
            padding: 0.625rem 1rem;
            border-radius: 9999px;
            border: 1px solid ${args.isDark ? '#27272a' : '#e4e4e7'};
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            z-index: 10;
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }
        .zoom-btn {
            width: 1.75rem;
            height: 1.75rem;
            background: ${args.isDark ? '#27272a' : '#f4f4f5'};
            border: none;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
            font-size: 0.875rem;
            font-weight: 700;
            color: ${args.isDark ? '#fafafa' : '#09090b'};
        }
        .zoom-btn:hover {
            background: ${args.isDark ? '#3f3f46' : '#e4e4e7'};
            transform: scale(1.1);
        }
        .zoom-btn:active { transform: scale(0.95); }
        .slider-container { display: flex; align-items: center; gap: 0.625rem; }
        .zoom-slider {
            width: 80px;
            height: 3px;
            -webkit-appearance: none;
            appearance: none;
            background: ${args.isDark ? '#27272a' : '#e4e4e7'};
            border-radius: 9999px;
            outline: none;
            cursor: pointer;
        }
        .zoom-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 14px;
            height: 14px;
            background: ${args.isDark ? '#fafafa' : '#09090b'};
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.2s;
        }
        .zoom-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
        .zoom-slider::-moz-range-thumb {
            width: 14px;
            height: 14px;
            background: ${args.isDark ? '#fafafa' : '#09090b'};
            border: none;
            border-radius: 50%;
            cursor: pointer;
            transition: all 0.2s;
        }
        .zoom-slider::-moz-range-thumb:hover { transform: scale(1.2); }
        .zoom-label {
            font-size: 0.75rem;
            font-weight: 600;
            color: ${args.isDark ? '#fafafa' : '#09090b'};
            min-width: 3rem;
            text-align: center;
        }
        .instructions {
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            background: ${args.isDark ? 'rgba(24, 24, 27, 0.95)' : 'rgba(250, 250, 250, 0.95)'};
            backdrop-filter: blur(12px);
            padding: 0.625rem 1rem;
            border-radius: 9999px;
            border: 1px solid ${args.isDark ? '#27272a' : '#e4e4e7'};
            box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
            font-size: 0.75rem;
            color: ${args.isDark ? '#a1a1aa' : '#71717a'};
            z-index: 10;
            display: flex;
            gap: 0.75rem;
            align-items: center;
        }
        .instructions > div { display: flex; align-items: center; gap: 0.375rem; }
        .instructions kbd {
            padding: 0.125rem 0.5rem;
            background: ${args.isDark ? '#27272a' : '#e4e4e7'};
            border-radius: 0.375rem;
            font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
            font-size: 0.7rem;
            font-weight: 500;
        }
    </style>
</head>
<body>
    <div class="header">
        <div>
            <h1>${name}</h1>
            <div class="description">${description}</div>
        </div>
    </div>
    <div id="container" class="graph-container">
        <img id="graphImage" class="graph-image" src="${args.dataUrl}" alt="OSINT Graph">
    </div>
    <div class="zoom-control">
        <button class="zoom-btn" onclick="zoomOut()" title="Zoom Out">−</button>
        <div class="slider-container">
            <input type="range" id="zoomSlider" class="zoom-slider" min="30" max="150" value="60" step="5">
            <div class="zoom-label" id="zoomLabel">100%</div>
        </div>
        <button class="zoom-btn" onclick="zoomIn()" title="Zoom In">+</button>
    </div>
    <div class="instructions">
        <div><kbd>Wheel</kbd> Zoom</div>
        <div><kbd>Drag</kbd> Pan</div>
        <div><kbd>Double-click</kbd> Zoom In</div>
    </div>
    <script>
        let scale = 0.6;
        let translateX = 0;
        let translateY = 0;
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        const container = document.getElementById('container');
        const img = document.getElementById('graphImage');
        const slider = document.getElementById('zoomSlider');
        const zoomLabel = document.getElementById('zoomLabel');
        function updateTransform(withTransition = false) {
            if (withTransition) img.style.transition = 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)';
            else img.style.transition = 'none';
            img.style.transform = \`translate(-50%, -50%) translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
            zoomLabel.textContent = Math.round(scale * 100) + '%';
            slider.value = Math.round(scale * 100);
        }
        function zoomIn() {
            const newScale = Math.min(scale + 0.1, 1.5);
            scale = newScale;
            updateTransform(true);
        }
        function zoomOut() {
            const newScale = Math.max(scale - 0.1, 0.3);
            scale = newScale;
            updateTransform(true);
        }
        slider.addEventListener('input', (e) => {
            const percent = parseInt(e.target.value);
            scale = percent / 100;
            img.style.transition = 'none';
            img.style.transform = \`translate(-50%, -50%) translate(\${translateX}px, \${translateY}px) scale(\${scale})\`;
            zoomLabel.textContent = percent + '%';
        });
        container.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? -0.1 : 0.1;
            const newScale = Math.min(Math.max(scale + delta, 0.3), 1.5);
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const deltaX = (mouseX - centerX - translateX) / scale;
            const deltaY = (mouseY - centerY - translateY) / scale;
            translateX -= deltaX * (newScale - scale);
            translateY -= deltaY * (newScale - scale);
            scale = newScale;
            updateTransform(false);
        }, { passive: false });
        container.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX - translateX;
            startY = e.clientY - translateY;
            container.classList.add('dragging');
        });
        container.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            translateX = e.clientX - startX;
            translateY = e.clientY - startY;
            updateTransform(false);
        });
        container.addEventListener('mouseup', () => {
            isDragging = false;
            container.classList.remove('dragging');
        });
        container.addEventListener('mouseleave', () => {
            isDragging = false;
            container.classList.remove('dragging');
        });
        container.addEventListener('dblclick', (e) => {
            const newScale = Math.min(scale + 0.3, 1.5);
            const rect = container.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const deltaX = (mouseX - centerX - translateX) / scale;
            const deltaY = (mouseY - centerY - translateY) / scale;
            translateX -= deltaX * (newScale - scale);
            translateY -= deltaY * (newScale - scale);
            scale = newScale;
            updateTransform(true);
        });
        window.addEventListener('load', () => {
            updateTransform(true);
        });
    </script>
</body>
</html>`;
}
