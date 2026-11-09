import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mapOsintIndustryResults,
  osintIndustriesPluginExecutor
} from './osint-industries-plugin';

// Fixtures follow the documented response shape: the sandbox examples of the
// API's own OpenAPI schema and the spec format tutorial on docs.osint.industries.
const spec = (proper_key: string, value: unknown, type = 'str') => ({
  proper_key,
  value,
  type
});

const instaband = {
  module: 'instaband',
  category: { type: 'Activity', name: 'Health & Fitness' },
  status: 'found',
  query: 'jack@gmail.com',
  from: 'User supplied email.',
  reliable_source: true,
  data: { data: true },
  spec_format: [
    {
      registered: spec('Registered', true, 'bool'),
      name: spec('Name', 'Brittany Martinez'),
      username: spec('Username', 'ngonzales'),
      location: spec('Location', 'Perkinsside, BE'),
      creation_date: spec('Creation Date', '2019-03-05T15:34:38', 'datetime'),
      gender: spec('Gender', 'male'),
      platform_variables: [
        { key: 'followers', proper_key: 'Followers', value: 277388, type: 'int' }
      ]
    }
  ],
  front_schemas: [
    {
      module: 'InstaBand',
      kind: 'user',
      image: 'https://i.pravatar.cc/200?u=ngonzales',
      body: { Name: 'Brittany Martinez', Followers: 277388 },
      tags: [
        { tag: 'Perkinsside, BE' },
        { tag: 'Profile', url: 'https://instaband.com/ngonzales' },
        { tag: 'Male' }
      ],
      timeline: { registered_date: null, last_seen_date: null },
      map: [
        {
          type: 'lat_lng',
          lat_lng: [57.733063, 14.227727],
          popup: { address: '4875 Amber Dale, Nguyenhaven, NC 38774' }
        }
      ]
    }
  ]
};

const breach = {
  module: 'breach',
  status: 'found',
  query: 'jack@gmail.com',
  spec_format: [
    {
      registered: spec('Registered', true, 'bool'),
      breach: spec('Breach', true, 'bool'),
      name: spec('Name', 'Stewart-Roberts'),
      creation_date: spec('Creation Date', '2023-11-11T13:55:27', 'datetime'),
      platform_variables: [
        { key: 'breach_count', proper_key: 'Breach Count', value: 445902501, type: 'int' },
        {
          key: 'data_classes',
          proper_key: 'Data Classes',
          value: ['Passwords', 'Names', 'Phone numbers'],
          type: 'list'
        }
      ]
    }
  ],
  front_schemas: [
    {
      module: 'Stewart-Roberts',
      kind: 'aggregator',
      image: 'https://logos.haveibeenpwned.com/Stewart-Roberts.png',
      body: {
        'Breach Date': '2023-11-11T13:55:27',
        'Data Classes': 'Passwords, Names, Phone numbers',
        Title: 'Stewart-Roberts'
      },
      tags: [
        { tag: 'Website', url: 'cruz.com' },
        { tag: 'Passwords' },
        { tag: 'Breach Count: 445,902,501' }
      ]
    }
  ]
};

const duolingo = {
  module: 'duolingo',
  status: 'found',
  query: 'jack@gmail.com',
  pretty_data: {},
  data: { users: [{ username: 'jj17686' }] },
  front_schemas: [
    {
      module: 'Duolingo',
      image: 'https://simg-ssl.duolingo.com/avatar/default_2/xlarge',
      body: {
        Username: 'jj17686',
        Learning: 'ES from EN',
        Premium: 'False',
        'Email Verified': 'False',
        'Total XP': '0',
        'Created At': '2013-04-03 18:37:06',
        ID: '2699322'
      },
      tags: [{ tag: 'Learning Spanish (0 XP)' }],
      timeline: { registered_date: '2013-04-03T18:37:06', last_seen_date: null }
    }
  ],
  spec_format: [
    {
      registered: spec('Registered', true, 'bool'),
      id: spec('Id', '2699322'),
      picture_url: spec(
        'Picture Url',
        'https://simg-ssl.duolingo.com/avatar/default_2/xlarge'
      ),
      username: spec('Username', 'jj17686'),
      profile_url: spec('Profile Url', 'https://www.duolingo.com/profile/jj17686'),
      premium: spec('Premium', false, 'bool'),
      creation_date: spec('Creation Date', '2013-04-03T18:37:06', 'datetime'),
      platform_variables: [
        { key: 'learning_language', proper_key: 'Learning Language', value: 'es', type: 'str' },
        { key: 'email_verified', proper_key: 'Email Verified', value: false, type: 'bool' },
        { key: 'motivation', proper_key: 'Motivation', value: 'none', type: 'str' },
        { key: 'roles', proper_key: 'Roles', value: ['users'], type: 'list' },
        { key: 'total_xp', proper_key: 'Total Xp', value: 0, type: 'int' },
        { key: 'streak', proper_key: 'Streak', value: 0, type: 'int' },
        { key: 'streak_data', proper_key: 'Streak Data', value: { currentStreak: null }, type: 'dict' },
        { key: 'courses', proper_key: 'Courses', value: [{ id: 'DUOLINGO_ES_EN' }], type: 'list' }
      ]
    }
  ]
};

function cards(entities: ReturnType<typeof mapOsintIndustryResults>['entities']) {
  return entities.filter((entity) => entity.metadata.nodeView === 'card');
}

describe('OSINT Industries result mapping', () => {
  it('turns a record into one card that keeps every public field', () => {
    const { entities, edges } = mapOsintIndustryResults(
      'source',
      [instaband],
      'jack@gmail.com'
    );
    const [card] = cards(entities);

    expect(card).toMatchObject({
      type: 'social',
      label: 'InstaBand · Brittany Martinez',
      value: 'ngonzales'
    });
    expect(card.metadata).toEqual({
      nodeView: 'card',
      customTitle: 'InstaBand',
      image: 'https://i.pravatar.cc/200?u=ngonzales',
      logoDomain: 'instaband.com',
      module: 'instaband',
      provider: 'OSINT Industries',
      Name: 'Brittany Martinez',
      Username: 'ngonzales',
      Location: 'Perkinsside, BE',
      Gender: 'male',
      'Creation Date': '2019-03-05T15:34:38',
      Followers: 277388,
      Profile: 'https://instaband.com/ngonzales',
      Map: ['57.733063, 14.227727 (4875 Amber Dale, Nguyenhaven, NC 38774)'],
      Category: 'Health & Fitness'
    });
    expect(edges[0]).toMatchObject({
      sourceId: 'source',
      targetId: card.id,
      label: 'Account'
    });

    // The username is a new selector, so it also becomes a linked node.
    const username = entities.find((entity) => entity.type === 'username');
    expect(username?.value).toBe('ngonzales');
    expect(edges).toContainEqual(
      expect.objectContaining({
        sourceId: card.id,
        targetId: username?.id,
        label: 'Username'
      })
    );
  });

  it('merges spec_format, platform variables and body without duplicates', () => {
    const { entities } = mapOsintIndustryResults(
      'source',
      [duolingo],
      'jack@gmail.com'
    );
    const [card] = cards(entities);

    expect(card.label).toBe('Duolingo · jj17686');
    expect(card.metadata.logoDomain).toBe('duolingo.com');
    const fields = Object.fromEntries(
      Object.entries(card.metadata).filter(([key]) => /^[A-Z]/.test(key))
    );
    expect(fields).toEqual({
      Username: 'jj17686',
      'Profile Url': 'https://www.duolingo.com/profile/jj17686',
      Premium: false,
      Id: '2699322',
      'Creation Date': '2013-04-03T18:37:06',
      'Learning Language': 'es',
      'Email Verified': false,
      Roles: ['users'],
      'Total Xp': 0,
      Streak: 0,
      Learning: 'ES from EN',
      Tags: ['Learning Spanish (0 XP)']
    });
  });

  it('keeps a username that only differs from the name by spacing', () => {
    const { entities } = mapOsintIndustryResults(
      'source',
      [
        {
          module: 'github',
          status: 'found',
          spec_format: [
            {
              name: spec('Name', 'Jack Sparrow'),
              username: spec('Username', 'jacksparrow')
            }
          ],
          front_schemas: [{ module: 'GitHub' }]
        }
      ],
      'jack@gmail.com'
    );
    expect(cards(entities)[0].metadata).toMatchObject({
      Name: 'Jack Sparrow',
      Username: 'jacksparrow'
    });
  });

  it('maps breach records to breach nodes titled after the breach', () => {
    const { entities, edges } = mapOsintIndustryResults(
      'source',
      [breach],
      'jack@gmail.com'
    );

    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({
      type: 'breach',
      label: 'Stewart-Roberts'
    });
    expect(entities[0].metadata).toMatchObject({
      nodeView: 'card',
      image: 'https://logos.haveibeenpwned.com/Stewart-Roberts.png',
      'Breach Count': 445902501,
      'Data Classes': ['Passwords', 'Names', 'Phone numbers'],
      Website: 'cruz.com',
      Tags: ['Passwords', 'Breach Count: 445,902,501']
    });
    expect(entities[0].metadata).not.toHaveProperty('customTitle');
    expect(entities[0].metadata).not.toHaveProperty('Breach Date');
    expect(edges[0].label).toBe('Breach');
  });

  it('names presence-only phone results after the platform and the number', () => {
    const { entities } = mapOsintIndustryResults(
      'source',
      [
        {
          module: 'whatsapp',
          status: 'found',
          query: '+14155552671',
          pretty_data: {},
          front_schemas: [
            {
              module: 'Whatsapp',
              image: 'https://pps.whatsapp.net/v/photo.jpg',
              body: { Bio: 'Available', 'Bio Set Date': '2021-05-01T10:00:00' },
              tags: [{ tag: 'Registered' }]
            }
          ],
          spec_format: [
            {
              registered: spec('Registered', true, 'bool'),
              picture_url: spec('Picture Url', 'https://pps.whatsapp.net/v/photo.jpg'),
              bio: spec('Bio', 'Available'),
              platform_variables: [
                { key: 'bio_set_date', proper_key: 'Bio Set Date', value: '2021-05-01T10:00:00', type: 'str' },
                { key: 'enterprise', proper_key: 'Enterprise', value: null, type: 'null' }
              ]
            }
          ]
        },
        {
          module: 'truecaller',
          status: 'found',
          pretty_data: {},
          front_schemas: [{ module: 'TrueCaller', tags: [{ tag: 'Registered' }] }],
          spec_format: [{ registered: spec('Registered', true, 'bool') }]
        }
      ],
      '+14155552671'
    );

    expect(entities.map((entity) => [entity.type, entity.label, entity.value])).toEqual([
      ['whatsapp_number', 'Whatsapp · +14155552671', '+14155552671'],
      ['social', 'TrueCaller · +14155552671', '+14155552671']
    ]);
    expect(entities[0].metadata).toMatchObject({
      image: 'https://pps.whatsapp.net/v/photo.jpg',
      Bio: 'Available',
      'Bio Set Date': '2021-05-01T10:00:00',
      Tags: ['Registered']
    });
    expect(entities[0].metadata).not.toHaveProperty('Enterprise');
    expect(entities[1].metadata.Tags).toEqual(['Registered']);
  });

  it('skips misses and secrets but keeps account flags', () => {
    const { entities } = mapOsintIndustryResults(
      'source',
      [
        {
          module: 'github',
          status: 'found',
          front_schemas: [
            {
              module: 'GitHub',
              body: {
                Username: 'ada',
                Password: 'do-not-import',
                'Session Token': 'do-not-import',
                'Has Password': true
              }
            }
          ]
        },
        { module: 'skype', status: 'not_found', pretty_data: { username: 'nope' } }
      ],
      'ada@example.com'
    );

    const [card] = cards(entities);
    expect(card.type).toBe('github_user');
    expect(card.metadata['Has Password']).toBe(true);
    expect(JSON.stringify(entities)).not.toContain('do-not-import');
    expect(JSON.stringify(entities)).not.toContain('nope');
  });

  it('keeps extra front_schemas records as their own cards', () => {
    const { entities } = mapOsintIndustryResults(
      'source',
      [
        {
          module: 'calendar',
          status: 'found',
          front_schemas: [
            { module: 'Calendar', body: { 'Time Zone': 'Europe/Rome' } },
            { module: 'Calendar Event 1', body: { Summary: 'Standup' } },
            { module: 'Calendar Event 2', body: { Summary: 'Retro' } }
          ],
          spec_format: [{ registered: spec('Registered', true, 'bool') }]
        }
      ],
      'jack@gmail.com'
    );

    expect(entities.map((entity) => entity.label)).toEqual([
      'Calendar · jack@gmail.com',
      'Calendar Event 1 · jack@gmail.com',
      'Calendar Event 2 · jack@gmail.com'
    ]);
    expect(entities[1].metadata.Summary).toBe('Standup');
  });

  it('keeps labels unique and links shared selectors once', () => {
    const skype = (username: string) => ({
      module: 'skype',
      status: 'found',
      spec_format: [
        {
          name: spec('Name', 'John Smith'),
          username: spec('Username', username),
          email: spec('Email', 'john@work.com, j***@mail.com'),
          phone: spec('Phone', '+1 415-555-2671')
        }
      ],
      front_schemas: [{ module: 'Skype' }]
    });
    const { entities, edges } = mapOsintIndustryResults(
      'source',
      [skype('live:john'), skype('live:john'), skype('live:jsmith')],
      '+14155552671'
    );

    expect(cards(entities).map((entity) => entity.label)).toEqual([
      'Skype · John Smith',
      'Skype · John Smith (2)'
    ]);
    // One node per selector; the masked email and the searched phone are skipped.
    expect(
      entities
        .filter((entity) => entity.metadata.nodeView !== 'card')
        .map((entity) => [entity.type, entity.value])
    ).toEqual([
      ['email', 'john@work.com'],
      ['username', 'live:john'],
      ['username', 'live:jsmith']
    ]);
    const email = entities.find((entity) => entity.type === 'email');
    expect(edges.filter((edge) => edge.targetId === email?.id)).toHaveLength(2);
  });
});

describe('OSINT Industries search request', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const event = (value: unknown) => `data:${JSON.stringify(value)}\n\n`;
  const ongoing = { type: 'info', status: 'ongoing', message: 'Working' };
  const finished = { type: 'info', status: 'finished' };

  /** A streamed response; each string is one network chunk. */
  function streamed(chunks: string[], failAfter = false) {
    const encoder = new TextEncoder();
    const pending = [...chunks];
    return new Response(
      new ReadableStream({
        pull(controller) {
          const chunk = pending.shift();
          if (chunk !== undefined) controller.enqueue(encoder.encode(chunk));
          else if (failAfter) controller.error(new Error('connection reset'));
          else controller.close();
        }
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    );
  }

  function stubFetch(response: () => Response) {
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
      async () => response()
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  function json(status: number, body: unknown) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  }

  function run(
    transformId: string,
    value: string,
    config: Record<string, unknown>,
    onProgress?: Parameters<typeof osintIndustriesPluginExecutor.execute>[2]
  ) {
    return osintIndustriesPluginExecutor.execute(
      transformId,
      { entity: { id: 'source', type: 'email', value }, config },
      onProgress
    );
  }

  it('streams the documented JSON body from the v2 stream route', async () => {
    const fetchMock = stubFetch(() =>
      streamed([event(ongoing), event(instaband), event(finished)])
    );
    const result = await run('osintind-email', ' jack@gmail.com ', {
      apiKey: 'key'
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.osint.industries/v2/request/stream');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'api-key': 'key',
      accept: 'text/event-stream',
      'content-type': 'application/json'
    });
    expect(JSON.parse(String(init.body))).toEqual({
      type: 'email',
      query: 'jack@gmail.com',
      timeout: 60,
      premium: false,
      info_signals: true
    });
    expect(result.success).toBe(true);
    expect(result.entities[0].label).toBe('InstaBand · Brittany Martinez');
    expect(result.message).toBe('Found 2 linked record(s).');
  });

  it('reads lines split across chunks and reports each module found', async () => {
    const line = event(duolingo);
    stubFetch(() =>
      streamed([
        event(instaband).slice(0, 40),
        event(instaband).slice(40) + line.slice(0, 10),
        line.slice(10) + 'data:{"module":"skype","status":"not_found"}\n',
        event(finished)
      ])
    );
    const progress = vi.fn();
    const result = await run('osintind-email', 'jack@gmail.com', { apiKey: 'key' }, progress);

    expect(result.entities.filter((entity) => entity.metadata.nodeView === 'card')).toHaveLength(2);
    expect(progress.mock.calls.map(([update]) => update.message)).toEqual([
      '1 found so far, latest: InstaBand',
      '2 found so far, latest: Duolingo'
    ]);
    expect(progress.mock.calls[0][0].progress).toBeGreaterThanOrEqual(0);
  });

  it('keeps the modules already received when the stream breaks', async () => {
    stubFetch(() => streamed([event(instaband)], true));
    const result = await run('osintind-email', 'jack@gmail.com', { apiKey: 'key' });
    expect(result.success).toBe(true);
    expect(result.entities.length).toBeGreaterThan(0);
    expect(result.message).toMatch(/results may be partial/);
  });

  it('fails with the stream error when nothing was found', async () => {
    stubFetch(() => streamed([event({ error: 'Invalid query.' })]));
    const result = await run('osintind-email', 'jack@gmail.com', { apiKey: 'key' });
    expect(result).toMatchObject({
      success: false,
      error: 'OSINT Industries: Invalid query.'
    });
  });

  it('asks for exact matches on name searches', async () => {
    const fetchMock = stubFetch(() => streamed([event(finished)]));
    await run('osintind-name', 'John Smith', { apiKey: 'key', premiumModules: true });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init.body))).toMatchObject({
      type: 'name',
      exact_match: true,
      premium: true
    });
  });

  it('types IP and domain lookups as the searched selector', async () => {
    const fetchMock = stubFetch(() =>
      streamed([
        event({
          module: 'ipinfo',
          status: 'found',
          front_schemas: [{ module: 'IPinfo', body: { Country: 'US', Org: 'Google LLC' } }]
        }),
        event(finished)
      ])
    );
    const result = await run('osintind-ip', '8.8.8.8', { apiKey: 'key' });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).type).toBe('ip');
    expect(result.entities[0]).toMatchObject({
      type: 'ip',
      label: 'IPinfo · 8.8.8.8',
      value: '8.8.8.8'
    });
    expect(result.entities[0].metadata).toMatchObject({ Country: 'US', Org: 'Google LLC' });
    expect(result.edges[0].label).toBe('Record');
  });

  it('labels sandbox results as test data', async () => {
    const fetchMock = stubFetch(() =>
      streamed([event(instaband), event(finished)])
    );
    const result = await run('osintind-email', 'jack@gmail.com', {
      apiKey: 'key',
      sandbox: true
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.osint.industries/sandbox/request/stream');
    expect(JSON.parse(String(init.body))).toMatchObject({
      timeout: 20,
      limit: 30,
      simulated_delay: true
    });
    expect(result.message).toMatch(/^Sandbox test data\./);
    expect(result.entities[0].metadata.provider).toBe(
      'OSINT Industries sandbox (test data)'
    );

  });

  it('refuses IP and domain lookups in the sandbox before calling it', async () => {
    const fetchMock = stubFetch(() => streamed([]));
    const result = await run('osintind-domain', 'example.com', {
      apiKey: 'key',
      sandbox: true
    });
    expect(result.error).toMatch(/sandbox has no IP or domain data/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [401, { error: 'Unauthorized.' }, 'OSINT Industries: invalid or missing API key'],
    [402, { error: 'Insufficient credits.' }, 'OSINT Industries: insufficient credits'],
    [400, { error: 'Invalid query.' }, 'OSINT Industries: Invalid query.'],
    [429, {}, 'OSINT Industries: rate limit reached, try again shortly'],
    [500, {}, 'OSINT Industries: search failed, credits were refunded']
  ])('reports HTTP %i clearly', async (status, body, message) => {
    stubFetch(() => json(status, body));
    const result = await run('osintind-email', 'jack@gmail.com', { apiKey: 'key' });
    expect(result).toMatchObject({ success: false, error: message });
  });

  it('fails before calling the API without a key', async () => {
    const fetchMock = stubFetch(() => streamed([]));
    const result = await run('osintind-email', 'jack@gmail.com', {});
    expect(result.error).toBe('OSINT Industries API key not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
