// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import L from 'leaflet';
import {
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap
} from './leaflet-adapter';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let activeMap: L.Map;
const icon = L.divIcon({ html: '<span>point</span>', iconSize: [24, 24] });
function CaptureMap() {
  const map = useMap();
  useEffect(() => {
    activeMap = map;
  }, [map]);
  return null;
}
function Scene({
  latitude = 10,
  onClick = () => {},
  dark = false,
  label = 'Point'
}) {
  return (
    <StrictMode>
      <MapContainer center={[10, 20]} zoom={5} zoomControl={false}>
        <TileLayer
          url={`https://example.invalid/${dark ? 'dark' : 'light'}/{z}/{x}/{y}.png`}
        />
        <Marker
          position={[latitude, 20]}
          icon={icon}
          zIndexOffset={latitude}
          eventHandlers={{ click: onClick }}
        >
          <Tooltip>
            <span>{label}</span>
          </Tooltip>
        </Marker>
        <CaptureMap />
      </MapContainer>
    </StrictMode>
  );
}
async function render(scene: React.ReactNode) {
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => {
    root!.render(scene);
  });
}
function layers<T extends L.Layer>(type: new (...args: any[]) => T): T[] {
  const result: T[] = [];
  activeMap.eachLayer((layer) => {
    if (layer instanceof type) result.push(layer);
  });
  return result;
}
afterEach(async () => {
  if (root)
    await act(async () => {
      root!.unmount();
    });
  root = undefined;
  host?.remove();
  host = undefined;
});
describe('local Leaflet integration', () => {
  it('creates one map in StrictMode and updates markers and click handlers without duplicates', async () => {
    const first = vi.fn(),
      second = vi.fn();
    await render(<Scene onClick={first} />);
    expect(host!.querySelectorAll('.leaflet-container')).toHaveLength(1);
    expect(layers(L.Marker)).toHaveLength(1);
    layers(L.Marker)[0].fire('click');
    expect(first).toHaveBeenCalledTimes(1);
    const map = activeMap;
    await render(<Scene latitude={35} onClick={second} />);
    expect(activeMap).toBe(map);
    expect(layers(L.Marker)).toHaveLength(1);
    const marker = layers(L.Marker)[0];
    expect(marker.getLatLng().lat).toBe(35);
    expect(marker.options.zIndexOffset).toBe(35);
    marker.fire('click');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
  it('changes tile layers and renders untrusted labels as text', async () => {
    const label = '<img src=x onerror=alert(1)>';
    await render(<Scene label={label} />);
    const oldLayer = layers(L.TileLayer)[0];
    await render(<Scene dark label={label} />);
    expect(layers(L.TileLayer)).toHaveLength(1);
    expect(activeMap.hasLayer(oldLayer)).toBe(false);
    const tooltip = layers(L.Marker)[0].getTooltip();
    const element = tooltip!.getContent() as HTMLElement;
    expect(element.textContent).toBe(label);
    expect(element.querySelector('img')).toBeNull();
  });
  it('removes the Leaflet instance so the same element can be mounted again', async () => {
    await render(<Scene />);
    const map = activeMap;
    const remove = vi.spyOn(map, 'remove');
    await act(async () => root!.render(null));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(host!.querySelector('.leaflet-container')).toBeNull();
    await render(<Scene />);
    expect(activeMap).not.toBe(map);
    expect(layers(L.Marker)).toHaveLength(1);
  });
});
