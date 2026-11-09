import { describe, expect, it } from 'vitest';
import { cardSize } from '../components/graph-editor/utils/card-node';
import {
  CLASSIC_NODE_SIZE,
  isClassicResultType,
  resultNodeSize,
  withEntityValue
} from './result-node';

describe('withEntityValue', () => {
  it('keeps a value that differs from the label', () => {
    expect(withEntityValue({ module: 'github' }, ' ada ', 'GitHub · Ada')).toEqual({
      module: 'github',
      value: 'ada'
    });
  });

  it('leaves metadata alone when the label already is the value', () => {
    const metadata = { source: 'dns' };
    expect(withEntityValue(metadata, 'example.com', 'example.com')).toBe(metadata);
    expect(withEntityValue(undefined, '', 'label')).toEqual({});
  });

  it('never overwrites a value the plugin set', () => {
    expect(withEntityValue({ value: 'kept' }, 'other', 'label')).toEqual({
      value: 'kept'
    });
  });
});

describe('resultNodeSize', () => {
  it('sizes cards from their rows and classic entities at the shared size', () => {
    const metadata = { nodeView: 'card', Name: 'Ada', Username: 'ada' };
    expect(resultNodeSize('social', metadata)).toEqual(cardSize(metadata));
    expect(resultNodeSize('social', {})).toEqual(CLASSIC_NODE_SIZE);
    expect(resultNodeSize('ip')).toEqual(CLASSIC_NODE_SIZE);
  });

  it('starts nodes with their own body at the registry size and lets files size themselves', () => {
    expect(resultNodeSize('maps')).toEqual({ width: 320, height: 240 });
    expect(resultNodeSize('media_url')).toEqual({ width: 280, height: 200 });
    expect(resultNodeSize('pdf')).toBeUndefined();
    expect(isClassicResultType('social')).toBe(true);
    expect(isClassicResultType('note')).toBe(false);
    expect(isClassicResultType('pdf')).toBe(false);
  });
});
