import { describe, expect, it } from 'vitest';
import {
  isShortAffirmation,
  seedAuthorization,
  seedIsAuthorized,
  seedIsInGoal
} from './policy';

describe('seed authorization in conversation threads', () => {
  it.each([
    ['ora fai lo stesso per adidas', 'adidas.com', 'domain'],
    ['Analizza ADIDAS.', 'adidas.com', 'domain'],
    ['ora fai lo stesso per Adidas', 'https://www.adidas.com/', 'url'],
    ['Analizza New Balance', 'newbalance.com', 'domain'],
    ['analizza New Balance', 'new-balance.com', 'domain'],
    ['controlla Marks Spencer', 'marksspencer.co.uk', 'domain'],
    ['analizza Café', 'cafe.it', 'domain']
  ])(
    'allows a website candidate from a named entity: %s',
    (currentGoal, value, type) => {
      expect(seedAuthorization({ currentGoal, history: [] }, value, type)).toBe(
        'agent_inference'
      );
    }
  );
  it('resolves a short follow-up using a user-named brand in history', () => {
    expect(
      seedAuthorization(
        {
          currentGoal: 'procedi',
          history: [
            {
              goal: 'fai lo stesso per adidas',
              messages: ['Non posso aggiungere adidas.com.']
            }
          ]
        },
        'adidas.com',
        'domain'
      )
    ).toBe('agent_inference');
  });
  it.each([
    ['analizza nike', 'adidas.com', 'domain'],
    ['analizza adidas', 'adidas.unrelated.com', 'domain'],
    ['analizza adidas', 'notadidas.com', 'domain'],
    ['analizza adidas', 'adidas.evil.co.uk', 'domain'],
    ['analizza adidas', 'https://adidas.com@unrelated.com', 'url'],
    ['analizza adidas', 'https://user:pass@adidas.com', 'url'],
    ['analizza adidas', 'https://adidas.com/?token=secret', 'url'],
    ['analizza adidas', 'adidas.com:443', 'domain'],
    ['analizza adidas', 'adidas.com/path', 'domain'],
    ['analizza adidas', 'adidas.local', 'domain'],
    ['analizza adidas', 'person@adidas.com', 'email'],
    ['analizza adidas', '8.8.8.8', 'ip'],
    ['analizza user@adidas.com', 'adidas.org', 'domain'],
    ['analizza adidas.evil.com', 'adidas.com', 'domain'],
    ['analizza @adidas', 'adidas.com', 'domain']
  ])(
    'does not treat unrelated or sensitive targets as brand inference: %s -> %s',
    (currentGoal, value, type) => {
      expect(seedIsAuthorized({ currentGoal, history: [] }, value, type)).toBe(
        false
      );
    }
  );
  it('does not derive a new website from an assistant-only brand mention', () => {
    expect(
      seedIsAuthorized(
        {
          currentGoal: 'ok',
          history: [
            {
              goal: 'analizza nike',
              messages: ['Potrei cercare anche Adidas.']
            }
          ]
        },
        'adidas.com',
        'domain'
      )
    ).toBe(false);
  });
  it('accepts an exact domain followed by sentence punctuation', () => {
    expect(
      seedAuthorization(
        { currentGoal: 'Analizza adidas.com.', history: [] },
        'adidas.com',
        'domain'
      )
    ).toBe('user_request');
  });
  it('accepts seeds named in an earlier user goal', () => {
    expect(
      seedIsAuthorized(
        {
          currentGoal: 'procedi',
          history: [
            {
              goal: 'Trova i sottodomini di nike.com',
              messages: ['Il modulo non era disponibile.']
            }
          ]
        },
        'nike.com',
        'domain'
      )
    ).toBe(true);
  });

  it('accepts short confirmations when the prior turn named the seed', () => {
    expect(isShortAffirmation('procedi')).toBe(true);
    expect(
      seedIsAuthorized(
        {
          currentGoal: 'procedi',
          history: [
            {
              goal: 'controlla nike.com',
              messages: [
                'Confermi di voler aggiungere nike.com e cercarne i sottodomini?'
              ]
            }
          ]
        },
        'nike.com',
        'domain'
      )
    ).toBe(true);
  });

  it('accepts seeds proposed in the prior assistant turn when the user confirms', () => {
    expect(
      seedIsAuthorized(
        {
          currentGoal: 'ok',
          history: [
            {
              goal: 'analizza chainalysis.com',
              messages: ['Vuoi aggiungere nike.com?']
            }
          ]
        },
        'nike.com',
        'domain'
      )
    ).toBe(true);
  });

  it('rejects seeds that never appeared in the thread', () => {
    expect(
      seedIsAuthorized(
        {
          currentGoal: 'ok',
          history: [
            {
              goal: 'analizza chainalysis.com',
              messages: ['Posso espandere il grafo.']
            }
          ]
        },
        'nike.com',
        'domain'
      )
    ).toBe(false);
  });

  it('still requires a word boundary match in goals', () => {
    expect(
      seedIsInGoal('Analizza example.test.evil.invalid', 'example.test')
    ).toBe(false);
  });
});
