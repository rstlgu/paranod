/**
 * Note Analysis Plugin
 * Provides entity extraction, pattern matching, and text analysis for notes
 */

import type {
  PluginExecutor,
  TransformInput,
  TransformResult,
  OSINTEntity,
  OSINTEdge,
  EntityType
} from '../types';

// ============================================
// Helper Functions
// ============================================

function generateId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function generateEdgeId(): string {
  return `edge-note-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

// ============================================
// Entity Extraction Patterns
// ============================================

interface ExtractedEntity {
  type: EntityType;
  value: string;
  label: string;
  pattern: string;
}

const EXTRACTION_PATTERNS: Array<{
  type: EntityType;
  pattern: RegExp;
  name: string;
}> = [
  // Email
  {
    type: 'email',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
    name: 'Email Address'
  },
  // URLs
  {
    type: 'url',
    pattern: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi,
    name: 'URL'
  },
  // IPv4
  {
    type: 'ip',
    pattern:
      /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    name: 'IP Address'
  },
  // IPv6
  {
    type: 'ip',
    pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
    name: 'IPv6 Address'
  },
  // Phone Numbers (international format)
  {
    type: 'phone',
    pattern: /\+?[1-9]\d{1,14}(?:[-.\s]?\d{1,4}){1,5}/g,
    name: 'Phone Number'
  },
  // Bitcoin Addresses
  {
    type: 'wallet',
    pattern: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g,
    name: 'Bitcoin Address'
  },
  // Ethereum Addresses
  {
    type: 'wallet',
    pattern: /\b0x[a-fA-F0-9]{40}\b/g,
    name: 'Ethereum Address'
  },
  // MD5 Hashes
  {
    type: 'hash',
    pattern: /\b[a-fA-F0-9]{32}\b/g,
    name: 'MD5 Hash'
  },
  // SHA-1 Hashes
  {
    type: 'hash',
    pattern: /\b[a-fA-F0-9]{40}\b/g,
    name: 'SHA-1 Hash'
  },
  // SHA-256 Hashes
  {
    type: 'hash',
    pattern: /\b[a-fA-F0-9]{64}\b/g,
    name: 'SHA-256 Hash'
  },
  // Domains (simplified)
  {
    type: 'domain',
    pattern:
      /\b(?!-)[A-Za-z0-9-]{1,63}(?<!-)\.(?:[A-Za-z]{2,6}|[A-Za-z0-9-]{2,30}\.[A-Za-z]{2,3})\b/g,
    name: 'Domain'
  },
  // Twitter/X Handles
  {
    type: 'social',
    pattern: /@[A-Za-z0-9_]{1,15}\b/g,
    name: 'Twitter Handle'
  },
  // Coordinates
  {
    type: 'location',
    pattern: /-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+/g,
    name: 'Coordinates'
  }
];

function extractEntities(text: string): ExtractedEntity[] {
  const extracted: ExtractedEntity[] = [];
  const seen = new Set<string>();

  for (const { type, pattern, name } of EXTRACTION_PATTERNS) {
    const matches = text.match(pattern) || [];
    for (const match of matches) {
      const normalized = match.toLowerCase().trim();
      if (!seen.has(`${type}:${normalized}`)) {
        seen.add(`${type}:${normalized}`);
        extracted.push({
          type,
          value: match.trim(),
          label: `${name}: ${match.trim().substring(0, 30)}${match.length > 30 ? '...' : ''}`,
          pattern: name
        });
      }
    }
  }

  return extracted;
}

// ============================================
// Extract Entities from Note
// ============================================

async function extractFromNote(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity } = input;
  const noteText = entity.value;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  const extracted = extractEntities(noteText);

  // Convention: label = actual value displayed, value = identifier/type
  for (const item of extracted) {
    const entityId = generateId();
    entities.push({
      id: entityId,
      type: item.type,
      value: item.pattern, // Identifier (pattern type)
      label: item.value, // Displayed: the actual extracted value
      metadata: {
        extractedFrom: 'note',
        patternType: item.pattern,
        sourceNote: noteText.substring(0, 100)
      },
      source: 'note-extraction',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: entityId,
      label: 'extracted',
      relationship: 'extracted_from'
    });
  }

  // Create summary note if entities found
  if (extracted.length > 0) {
    const typeCounts: Record<string, number> = {};
    for (const item of extracted) {
      typeCounts[item.type] = (typeCounts[item.type] || 0) + 1;
    }

    // Build summary content
    const summaryLines = Object.entries(typeCounts)
      .map(([type, count]) => `• ${type}: ${count}`)
      .join('\n');
    const summaryContent = `📋 Extraction Summary

Found ${extracted.length} entities:

${summaryLines}`;

    const summaryId = generateId();
    entities.push({
      id: summaryId,
      type: 'note',
      value: 'Extraction Summary', // Identifier
      label: summaryContent, // Displayed: full summary
      metadata: {
        totalEntities: extracted.length,
        entityCounts: typeCounts,
        patterns: Array.from(new Set(extracted.map((e) => e.pattern)))
      },
      source: 'note-extraction',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: summaryId,
      label: 'summary',
      relationship: 'contains'
    });
  }

  return {
    success: true,
    entities,
    edges,
    message: `Extracted ${extracted.length} entities from note`,
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Keyword Analysis
// ============================================

async function analyzeKeywords(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity } = input;
  const noteText = entity.value;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  // Simple keyword extraction (word frequency)
  const words = noteText
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  const wordCounts: Record<string, number> = {};
  for (const word of words) {
    wordCounts[word] = (wordCounts[word] || 0) + 1;
  }

  // Get top keywords
  const topKeywords = Object.entries(wordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .filter(([_, count]) => count > 1);

  if (topKeywords.length > 0) {
    // Convention: label = displayed content, value = identifier
    const keywordLines = topKeywords
      .map(([word, count]) => `• ${word}: ${count} occurrences`)
      .join('\n');
    const keywordContent = `🔑 Keyword Analysis

Total words: ${words.length}
Unique words: ${Object.keys(wordCounts).length}

Top Keywords:
${keywordLines}`;

    const keywordId = generateId();
    entities.push({
      id: keywordId,
      type: 'note',
      value: 'Keywords Analysis', // Identifier
      label: keywordContent, // Displayed: full analysis
      metadata: {
        keywords: topKeywords.map(([word, count]) => ({ word, count })),
        totalWords: words.length,
        uniqueWords: Object.keys(wordCounts).length
      },
      source: 'keyword-analysis',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: keywordId,
      label: 'keywords',
      relationship: 'contains'
    });
  }

  return {
    success: true,
    entities,
    edges,
    message: `Analyzed ${words.length} words, found ${topKeywords.length} key terms`,
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Search Web for Note Content
// ============================================

async function searchForContent(
  input: TransformInput
): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity } = input;
  const noteText = entity.value;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  // Create search queries from the note content
  // Take first 100 chars or first sentence for search
  const searchText =
    noteText.length > 100
      ? noteText.substring(0, 100)
      : noteText.split(/[.!?]/)[0];

  const encodedQuery = encodeURIComponent(searchText.trim());

  const searchEngines = [
    {
      name: 'Google Search',
      url: `https://www.google.com/search?q="${encodedQuery}"`
    },
    {
      name: 'Bing Search',
      url: `https://www.bing.com/search?q="${encodedQuery}"`
    },
    {
      name: 'DuckDuckGo',
      url: `https://duckduckgo.com/?q="${encodedQuery}"`
    },
    {
      name: 'Archive.org Search',
      url: `https://archive.org/search?query=${encodedQuery}`
    }
  ];

  // Convention: label = URL displayed, value = identifier
  for (const engine of searchEngines) {
    const urlId = generateId();
    entities.push({
      id: urlId,
      type: 'url',
      value: engine.name, // Identifier
      label: engine.url, // Displayed: the actual URL
      metadata: {
        searchQuery: searchText,
        purpose: 'Content Search'
      },
      source: 'note-search',
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
    message: `Generated ${searchEngines.length} search links`,
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Create Timeline Entry
// ============================================

async function createTimeline(input: TransformInput): Promise<TransformResult> {
  const startTime = Date.now();
  const { entity } = input;
  const noteText = entity.value;

  const entities: OSINTEntity[] = [];
  const edges: OSINTEdge[] = [];

  // Extract dates from the note
  const datePatterns = [
    // ISO format
    /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?/g,
    // Common formats
    /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/g,
    // Written dates
    /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s*\d{2,4}/gi
  ];

  const foundDates: string[] = [];
  for (const pattern of datePatterns) {
    const matches = noteText.match(pattern) || [];
    foundDates.push(...matches);
  }

  if (foundDates.length > 0) {
    // Convention: label = displayed content, value = identifier
    const dateList = foundDates.map((d) => `• ${d}`).join('\n');
    const timelineContent = `📅 Timeline

Found ${foundDates.length} date(s):

${dateList}`;

    const timelineId = generateId();
    entities.push({
      id: timelineId,
      type: 'note',
      value: 'Timeline', // Identifier
      label: timelineContent, // Displayed: full timeline
      metadata: {
        dates: foundDates,
        sourceNote: noteText.substring(0, 200)
      },
      source: 'timeline-extraction',
      timestamp: new Date().toISOString()
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: timelineId,
      label: 'timeline',
      relationship: 'contains'
    });
  } else {
    // No dates found, create a timestamp entry
    // Convention: label = displayed, value = identifier
    const analysisTime = new Date().toISOString();
    const timestampContent = `📅 No Dates Found

Note analyzed at: ${analysisTime}
Note length: ${noteText.length} characters

No explicit dates were found in this note.`;

    const timestampId = generateId();
    entities.push({
      id: timestampId,
      type: 'note',
      value: 'Timestamp', // Identifier
      label: timestampContent, // Displayed
      metadata: {
        analysisDate: analysisTime,
        noteLength: noteText.length
      },
      source: 'timeline-extraction',
      timestamp: analysisTime
    });

    edges.push({
      id: generateEdgeId(),
      sourceId: entity.id,
      targetId: timestampId,
      label: 'timestamp',
      relationship: 'related_to'
    });
  }

  return {
    success: true,
    entities,
    edges,
    message: `Found ${foundDates.length} dates in note`,
    executionTime: Date.now() - startTime
  };
}

// ============================================
// Plugin Executor
// ============================================

export const notePluginExecutor: PluginExecutor = {
  async execute(
    transformId: string,
    input: TransformInput
  ): Promise<TransformResult> {
    switch (transformId) {
      case 'note-extract-entities':
        return extractFromNote(input);

      case 'note-keywords':
        return analyzeKeywords(input);

      case 'note-search':
        return searchForContent(input);

      case 'note-timeline':
        return createTimeline(input);

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
