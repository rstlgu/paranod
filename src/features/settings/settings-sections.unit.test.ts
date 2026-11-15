import { underlyingApplicationPath } from './settings-surface';
import { describe, expect, it } from 'vitest';
import { activeSettingsSection, SETTINGS_SECTIONS } from './settings-sections';

describe('settings navigation', () => {
  it('keeps account subroutes under account and does not match similar prefixes', () => {
    expect(activeSettingsSection('/settings/account/security', null)).toBe(
      '/settings/account'
    );
    expect(activeSettingsSection('/settings/account-other', null)).toBe(
      '/settings'
    );
  });
  it('selects addons independently from builtin plugins, including detail routes', () => {
    expect(activeSettingsSection('/plugins', 'addons')).toBe(
      '/plugins?tab=addons'
    );
    expect(activeSettingsSection('/plugins/addon%3Ademo', 'addons')).toBe(
      '/plugins?tab=addons'
    );
    expect(activeSettingsSection('/plugins/dns', null)).toBe('/plugins');
  });
  it('exposes only internal destinations with distinct navigation entries', () => {
    expect(new Set(SETTINGS_SECTIONS.map((s) => s.href)).size).toBe(
      SETTINGS_SECTIONS.length
    );
    expect(
      SETTINGS_SECTIONS.every(
        (s) => s.href.startsWith('/') && !s.href.startsWith('//')
      )
    ).toBe(true);
  });
});

describe('the application behind settings', () => {
  it('keeps workspace tabs and the docked agent on their originating route', () => {
    expect(
      underlyingApplicationPath('/settings/account', '/?open=graph:demo')
    ).toBe('/');
    expect(underlyingApplicationPath('/plugins/tool', '/cases?view=list')).toBe(
      '/cases'
    );
    expect(underlyingApplicationPath('/plugins-other', '/')).toBe(
      '/plugins-other'
    );
  });
});
