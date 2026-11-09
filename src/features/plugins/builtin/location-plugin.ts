/**
 * Location Analysis Plugin
 * Provides geocoding, reverse geocoding, and location intelligence
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
  return `loc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-loc-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// Parse Location Value
// ============================================

interface ParsedLocation {
  type: 'coordinates' | 'address' | 'place';
  latitude?: number;
  longitude?: number;
  address?: string;
  raw: string;
}

function parseLocation(value: string): ParsedLocation {
  // Try to parse as coordinates (lat, lon)
  const coordMatch = value.match(/(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)/);
  if (coordMatch) {
    const lat = parseFloat(coordMatch[1]);
    const lon = parseFloat(coordMatch[2]);
    if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return {
        type: 'coordinates',
        latitude: lat,
        longitude: lon,
        raw: value
      };
    }
  }

  // Otherwise treat as address/place name
  return {
    type: 'address',
    address: value,
    raw: value
  };
}

// ============================================
// Geocoding (Address to Coordinates)
// ============================================

async function geocode(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity, config } = input;
  const location = parseLocation(entity.value);

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  if (location.type === 'coordinates') {
    // Already has coordinates
    // Convention: label = displayed content, value = identifier
    const coords = `${location.latitude}, ${location.longitude}`;
    const noteId = generateId();
    entities.push({
      id: noteId,
      type: 'note',
      value: 'Coordinates', // Identifier
      label: `📍 ${coords}\n\nLocation already contains valid coordinates.`, // Displayed
      metadata: {
        latitude: location.latitude,
        longitude: location.longitude
      },
      source: 'geocoding',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: noteId,
      label: 'coordinates',
      relationship: 'contains'
    });

    return {
      success: true,
      entities,
      edges,
      message: 'Location already contains coordinates',
      executionTime: Date.now() - startTime
    };
  }

  // Use Nominatim (OpenStreetMap) for geocoding - free, no API key needed
  try {
    const encodedAddress = encodeURIComponent(location.address || entity.value);
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodedAddress}&format=json&limit=5`,
      {
        headers: {
          'User-Agent': 'PARANOD/1.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status}`);
    }

    const results = await response.json();

    if (results.length === 0) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: 'No geocoding results found for this address'
      };
    }

    // Add all results as potential locations
    // Convention: label = coordinates displayed, value = identifier
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const locId = generateId();
      const coords = `${result.lat}, ${result.lon}`;
      const placeName = result.display_name.split(',')[0];

      entities.push({
        id: locId,
        type: 'location',
        value: placeName, // Identifier (short name)
        label: coords, // Displayed: actual coordinates
        metadata: {
          latitude: parseFloat(result.lat),
          longitude: parseFloat(result.lon),
          displayName: result.display_name,
          type: result.type,
          class: result.class,
          importance: result.importance,
          boundingBox: result.boundingbox,
          osmId: result.osm_id,
          osmType: result.osm_type,
          resultIndex: i + 1
        },
        source: 'nominatim-geocoding',
        timestamp: new Date().toISOString()
      });

      edges.push({
        id: generateEdgeId(),
        sourceId: entity.id,
        targetId: locId,
        label: i === 0 ? 'geocoded to' : 'alternative',
        relationship: 'located_at'
      });
    }

    return {
      success: true,
      entities,
      edges,
      message: `Found ${results.length} geocoding results`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: `Geocoding failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================
// Reverse Geocoding (Coordinates to Address)
// ============================================

async function reverseGeocode(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity } = input;
  const location = parseLocation(entity.value);

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  if (
    location.type !== 'coordinates' ||
    !location.latitude ||
    !location.longitude
  ) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: 'Location must contain valid coordinates (latitude, longitude)'
    };
  }

  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${location.latitude}&lon=${location.longitude}&format=json`,
      {
        headers: {
          'User-Agent': 'PARANOD/1.0'
        }
      }
    );

    if (!response.ok) {
      throw new Error(`Nominatim error: ${response.status}`);
    }

    const result = await response.json();

    if (result.error) {
      return {
        success: false,
        entities: [],
        edges: [],
        error: result.error
      };
    }

    // Add address note
    // Convention: label = displayed content, value = identifier
    const addressId = generateId();
    entities.push({
      id: addressId,
      type: 'note',
      value: 'Address', // Identifier
      label: result.display_name, // Displayed: full address
      metadata: {
        ...result.address,
        osmId: result.osm_id,
        osmType: result.osm_type,
        category: result.category,
        type: result.type
      },
      source: 'reverse-geocoding',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: addressId,
      label: 'address',
      relationship: 'located_at'
    });

    // Extract country as organization
    if (result.address?.country) {
      const countryId = generateId();
      entities.push({
        id: countryId,
        type: 'organization',
        value: 'Country', // Identifier
        label: result.address.country, // Displayed: country name
        metadata: {
          type: 'country',
          countryCode: result.address.country_code?.toUpperCase()
        },
        source: 'reverse-geocoding',
        timestamp: new Date().toISOString()
      });

      edges.push({
        id: generateEdgeId(),
        sourceId: entity.id,
        targetId: countryId,
        label: 'in country',
        relationship: 'located_at'
      });
    }

    return {
      success: true,
      entities,
      edges,
      message: 'Reverse geocoding completed',
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: `Reverse geocoding failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================
// Nearby Places Search
// ============================================

async function searchNearby(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity, config } = input;
  const location = parseLocation(entity.value);

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  let lat: number, lon: number;

  if (
    location.type === 'coordinates' &&
    location.latitude &&
    location.longitude
  ) {
    lat = location.latitude;
    lon = location.longitude;
  } else {
    // Need to geocode first
    return {
      success: false,
      entities: [],
      edges: [],
      error:
        'Location must contain valid coordinates. Use Geocode transform first.'
    };
  }

  const radius = (config?.radius as number) || 1000; // meters
  const category = (config?.category as string) || 'amenity';

  try {
    // Use Overpass API for nearby POI search
    const query = `
      [out:json][timeout:25];
      (
        node["${category}"](around:${radius},${lat},${lon});
        way["${category}"](around:${radius},${lat},${lon});
      );
      out center 10;
    `;

    const response = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status}`);
    }

    const data = await response.json();

    // Convention: label = coordinates displayed, value = identifier (place name)
    for (const element of data.elements || []) {
      const tags = element.tags || {};
      const name = tags.name || tags[category] || 'Unknown';

      const poiLat = element.lat || element.center?.lat;
      const poiLon = element.lon || element.center?.lon;

      if (!poiLat || !poiLon) continue;

      const coords = `${poiLat}, ${poiLon}`;
      const poiId = generateId();
      entities.push({
        id: poiId,
        type: 'location',
        value: name, // Identifier (place name)
        label: coords, // Displayed: coordinates
        metadata: {
          latitude: poiLat,
          longitude: poiLon,
          placeName: name,
          category,
          ...tags,
          osmId: element.id,
          osmType: element.type
        },
        source: 'nearby-search',
        timestamp: new Date().toISOString()
      });

      edges.push({
        id: generateEdgeId(),
        sourceId: entity.id,
        targetId: poiId,
        label: 'nearby',
        relationship: 'related_to'
      });
    }

    return {
      success: true,
      entities,
      edges,
      message: `Found ${entities.length} nearby places`,
      executionTime: Date.now() - startTime
    };
  } catch (error) {
    return {
      success: false,
      entities: [],
      edges: [],
      error: `Nearby search failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// ============================================
// Generate Map Links
// ============================================

async function generateMapLinks(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity } = input;
  const location = parseLocation(entity.value);

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  let lat: number, lon: number;
  let searchQuery: string;

  if (
    location.type === 'coordinates' &&
    location.latitude &&
    location.longitude
  ) {
    lat = location.latitude;
    lon = location.longitude;
    searchQuery = `${lat},${lon}`;
  } else {
    searchQuery = encodeURIComponent(location.address || entity.value);
    // Use placeholder coords for URL generation
    lat = 0;
    lon = 0;
  }

  const mapServices = [
    {
      name: 'Google Maps',
      url:
        location.type === 'coordinates'
          ? `https://www.google.com/maps?q=${lat},${lon}`
          : `https://www.google.com/maps/search/${searchQuery}`
    },
    {
      name: 'Google Street View',
      url: `https://www.google.com/maps/@${lat},${lon},3a,75y,90t/data=!3m6!1e1!3m4!1s!2e0!7i16384!8i8192`
    },
    {
      name: 'OpenStreetMap',
      url:
        location.type === 'coordinates'
          ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}&zoom=17`
          : `https://www.openstreetmap.org/search?query=${searchQuery}`
    },
    {
      name: 'Bing Maps',
      url:
        location.type === 'coordinates'
          ? `https://www.bing.com/maps?cp=${lat}~${lon}&lvl=17`
          : `https://www.bing.com/maps?q=${searchQuery}`
    },
    {
      name: 'Apple Maps',
      url:
        location.type === 'coordinates'
          ? `https://maps.apple.com/?ll=${lat},${lon}&z=17`
          : `https://maps.apple.com/?q=${searchQuery}`
    },
    {
      name: 'Yandex Maps',
      url:
        location.type === 'coordinates'
          ? `https://yandex.com/maps/?ll=${lon},${lat}&z=17`
          : `https://yandex.com/maps/?text=${searchQuery}`
    }
  ];

  // Convention: label = URL displayed, value = identifier
  for (const service of mapServices) {
    const urlId = generateId();
    entities.push({
      id: urlId,
      type: 'url',
      value: service.name, // Identifier
      label: service.url, // Displayed: the actual URL
      metadata: {
        mapService: service.name,
        location: entity.value
      },
      source: 'map-links',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: urlId,
      label: `view on ${service.name}`,
      relationship: 'related_to'
    });
  }

  return {
    success: true,
    entities,
    edges,
    message: `Generated ${mapServices.length} map links`,
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Create Interactive Map Node
// ============================================

async function createMapNode(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity } = input;
  const location = parseLocation(entity.value);

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  let mapValue: string;
  let title: string;

  if (
    location.type === 'coordinates' &&
    location.latitude &&
    location.longitude
  ) {
    mapValue = `${location.latitude}, ${location.longitude}`;
    title = `Map: ${mapValue}`;
  } else {
    // Use address directly - MapContent will geocode it
    mapValue = location.address || entity.value;
    title = `Map: ${mapValue.substring(0, 30)}${mapValue.length > 30 ? '...' : ''}`;
  }

  const mapId = generateId();
  entities.push({
    id: mapId,
    type: 'maps',
    value: mapValue, // The location value (coordinates or address)
    label: mapValue, // Displayed in the node
    metadata: {
      title,
      sourceLocation: entity.value,
      locationType: location.type,
      ...(location.latitude && { latitude: location.latitude }),
      ...(location.longitude && { longitude: location.longitude })
    },
    source: 'location-map',
    timestamp: new Date().toISOString()
  });

  edges.push({
    id: generateEdgeId(),
    sourceId: entity.id,
    targetId: mapId,
    label: 'visualized on',
    relationship: 'related_to'
  });

  return {
    success: true,
    entities,
    edges,
    message: 'Created interactive map node',
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Plugin Executor
// ============================================

export const locationPluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'location-geocode':
        return geocode(input);

      case 'location-reverse':
        return reverseGeocode(input);

      case 'location-nearby':
        return searchNearby(input);

      case 'location-map-links':
        return generateMapLinks(input);

      case 'location-create-map':
        return createMapNode(input);

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
