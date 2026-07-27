import { describe, expect, it } from 'vitest';
import { validateBatteryCases, validateRagCases } from './validate.js';

describe('validateBatteryCases', () => {
  const ok = { tiers: [{ name: 'T', intent: 'i', questions: [{ id: 'q1', q: '?', redFlags: ['x'] }] }] };
  it('érvényes esetet átenged', () => {
    expect(() => validateBatteryCases(ok)).not.toThrow();
  });
  it('elgépelt kulcsra (redFlag) fail-fast — ez a legdrágább néma hiba', () => {
    const bad = { tiers: [{ name: 'T', intent: 'i', questions: [{ id: 'q1', q: '?', redFlag: ['x'] }] }] };
    expect(() => validateBatteryCases(bad)).toThrow(/ismeretlen kulcs "redFlag"/);
  });
  it('hiányzó tiers tömbre dob', () => {
    expect(() => validateBatteryCases({})).toThrow(/tiers/);
  });
  it('üres steps-ű beszélgetésre dob', () => {
    const bad = { tiers: [{ name: 'T', intent: 'i', conversations: [{ id: 'c', title: 't', steps: [] }] }] };
    expect(() => validateBatteryCases(bad)).toThrow(/steps/);
  });
});

describe('validateRagCases', () => {
  it('érvényes esetet átenged', () => {
    expect(() => validateRagCases({ cases: [{ id: 'r', question: 'q', groundTruth: 'g' }] })).not.toThrow();
  });
  it('elgépelt kulcsra dob', () => {
    expect(() => validateRagCases({ cases: [{ id: 'r', question: 'q', ground_truth: 'g' }] })).toThrow(/ismeretlen kulcs/);
  });
});
