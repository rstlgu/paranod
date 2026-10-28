export interface Coordinates {
  lat: number;
  lng: number;
}

// Regex per parsing coordinate
const COORD_REGEX = /^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/;
const DMS_REGEX = /(\d+)[°]\s*(\d+)?[']?\s*(\d+\.?\d*)?[""]?\s*([NSEW])/gi;

export function parseCoordinates(input: string): Coordinates | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Decimal: "41.9028, 12.4964" / "41.9028 12.4964"
  const decimalMatch = trimmed.match(COORD_REGEX);
  if (decimalMatch) {
    const lat = Number.parseFloat(decimalMatch[1] ?? '');
    const lng = Number.parseFloat(decimalMatch[2] ?? '');
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
      return { lat, lng };
  }

  // DMS: "41°54'10\"N 12°29'47\"E"
  const dmsMatches: RegExpExecArray[] = [];
  let dmsMatch: RegExpExecArray | null;
  while ((dmsMatch = DMS_REGEX.exec(trimmed)) !== null) dmsMatches.push(dmsMatch);
  DMS_REGEX.lastIndex = 0;
  if (dmsMatches.length >= 2) {
    const parseDmsMatch = (match: RegExpMatchArray) => {
      const deg = Number.parseFloat(match[1] ?? '') || 0;
      const min = Number.parseFloat(match[2] ?? '') || 0;
      const sec = Number.parseFloat(match[3] ?? '') || 0;
      const dir = String(match[4] ?? '').toUpperCase();
      let decimal = deg + min / 60 + sec / 3600;
      if (dir === 'S' || dir === 'W') decimal *= -1;
      return decimal;
    };

    const lat = parseDmsMatch(dmsMatches[0]);
    const lng = parseDmsMatch(dmsMatches[1]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)
      return { lat, lng };
  }

  return null;
}

export async function resolveValueToCoordinates(value: string) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return { coordinates: null as Coordinates | null, error: 'No location specified' };

  // 1) coordinates
  const coords = parseCoordinates(trimmed);
  if (coords) return { coordinates: coords, error: null as string | null };

  // 2) IP (ip-api.com)
  const ipRegex = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  if (ipRegex.test(trimmed)) {
    try {
      const response = await fetch(`http://ip-api.com/json/${trimmed}`);
      const data = await response.json();
      if (data?.status === 'success')
        return {
          coordinates: { lat: Number(data.lat), lng: Number(data.lon) },
          error: null
        };
      return { coordinates: null, error: 'IP geolocation failed' };
    } catch {
      return { coordinates: null, error: 'Failed to geolocate IP' };
    }
  }

  // 3) Address (Nominatim)
  try {
    const encoded = encodeURIComponent(trimmed);
    const response = await fetch(
      `https://nominatim.openstreetmap.workspace/search?format=json&q=${encoded}&limit=1`,
      { headers: { 'User-Agent': 'OSINTIT/1.0' } }
    );
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      return {
        coordinates: {
          lat: Number.parseFloat(String(data[0]?.lat ?? '')),
          lng: Number.parseFloat(String(data[0]?.lon ?? ''))
        },
        error: null
      };
    }
    return { coordinates: null, error: 'Address not found' };
  } catch {
    return { coordinates: null, error: 'Geocoding failed' };
  }
}
