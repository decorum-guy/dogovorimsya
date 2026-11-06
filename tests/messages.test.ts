import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import messages from '../content/homeMessages.json';
import { chooseHomeMessage } from '../src/lib/messages.js';
import { createMessagePicker, messageCycleKey } from '../src/lib/message-rotation.js';

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replaceAll('ё', 'е').replace(/[^\p{L}\p{N}]/gu, '');

test('large role pools are unique, short and preserve every original phrase verbatim', () => {
  assert.equal(messages.version, 2); assert.equal(messages.locale, 'ru-RU');
  const originals = {
    reviewer: '2995a1bfc89ca7eedcbc5d3655218a3249f48589d6816467badd2304da266f80',
    recipient: '5258a14b041f520ad65e69155a9dfa37957278baa83c61d7b582db8ae90732db',
  };
  for (const role of ['reviewer', 'recipient'] as const) {
    assert.ok(messages[role].length >= 300);
    const originalHash = createHash('sha256').update(JSON.stringify(messages[role].slice(0, 26))).digest('hex');
    assert.equal(originalHash, originals[role]);
    for (const phrase of messages[role]) { assert.equal(phrase, phrase.trim()); assert.ok(phrase.length > 0 && phrase.length <= 85, phrase); }
  }
  const all = [...messages.reviewer, ...messages.recipient];
  assert.equal(new Set(all.map(normalize)).size, all.length, 'punctuation, case and ё/е do not disguise duplicate phrases');
  assert.ok(messages.recipient.includes('Обжалуй меня.'));
});

test('each role completes its entire pool before repeating, including across cycle boundaries', () => {
  const cache = storage();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: cache });
  try {
    for (const role of ['reviewer', 'recipient'] as const) {
      let last = '';
      for (let cycle = 0; cycle < 2; cycle++) {
        const seen = new Set<string>();
        for (let i = 0; i < messages[role].length; i++) {
          const phrase = chooseHomeMessage(role, 101);
          assert.ok(messages[role].includes(phrase)); assert.notEqual(phrase, last); assert.ok(!seen.has(phrase));
          seen.add(phrase); last = phrase;
        }
        assert.deepEqual(seen, new Set(messages[role]));
      }
    }
    assert.equal(cache.values.size, 2, 'each role has an independent cycle even when account IDs match');
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('a reload continues the unseen part of the cycle; different accounts have their own bags', () => {
  const cache = storage();
  const first = createMessagePicker(messages, { storage: () => cache, random: () => 0 });
  const seen = Array.from({ length: 117 }, () => first('reviewer', 2));
  first('reviewer', 3);
  const reloaded = createMessagePicker(messages, { storage: () => cache, random: () => 0 });
  seen.push(...Array.from({ length: messages.reviewer.length - 117 }, () => reloaded('reviewer', 2)));
  assert.equal(new Set(seen).size, messages.reviewer.length);
  assert.equal(JSON.parse(cache.getItem(messageCycleKey('reviewer', 3))!).remaining.length, messages.reviewer.length - 1);
});

test('legacy last-message storage and new cycle boundaries do not repeat the previous greeting', () => {
  const cache = storage();
  const pools = { reviewer: ['Первый', 'Второй', 'Третий'], recipient: ['Её фраза'] };
  cache.setItem('dogovorimsya:last-message:1', 'Второй');
  const pick = createMessagePicker(pools, { storage: () => cache, random: () => 0 });
  const cycle = Array.from({ length: 3 }, () => pick('reviewer', 1));
  assert.notEqual(cycle[0], 'Второй'); assert.equal(new Set(cycle).size, 3);
  assert.notEqual(pick('reviewer', 1), cycle[2]);
  assert.deepEqual(pools.reviewer, ['Первый', 'Второй', 'Третий']);
});

test('pool edits invalidate old indices and damaged storage recovers without blank greetings', () => {
  const cache = storage();
  const pools = { reviewer: ['Один', 'Два', 'Три'], recipient: ['Её фраза'] };
  const pick = createMessagePicker(pools, { storage: () => cache, random: () => 0 });
  const last = pick('reviewer', 8);
  const saved = JSON.parse(cache.getItem(messageCycleKey('reviewer', 8))!);
  saved.remaining = [pools.reviewer.indexOf(last), pools.reviewer.indexOf(last)];
  cache.setItem(messageCycleKey('reviewer', 8), JSON.stringify(saved));
  assert.notEqual(pick('reviewer', 8), last);
  pools.reviewer.push('Новая фраза');
  const freshCycle = Array.from({ length: 4 }, () => pick('reviewer', 8));
  assert.deepEqual(new Set(freshCycle), new Set(pools.reviewer));
  cache.setItem(messageCycleKey('recipient', 9), '{broken json');
  assert.equal(pick('recipient', 9), 'Её фраза');
});

test('blocked or full localStorage still allows a nonrepeating cycle in memory', () => {
  for (const mode of ['blocked', 'full'] as const) {
    const broken = { getItem: () => { if (mode === 'blocked') throw new Error('Denied'); return null; }, setItem: () => { throw new Error('Quota'); } };
    const pick = createMessagePicker(messages, { storage: () => broken, random: () => 0 });
    const cycle = Array.from({ length: messages.recipient.length }, () => pick('recipient', 5));
    assert.equal(new Set(cycle).size, messages.recipient.length);
    assert.notEqual(pick('recipient', 5), cycle.at(-1));
  }
});

test('empty and single-item pools have safe fallbacks without endless retry loops', () => {
  const pick = createMessagePicker({ reviewer: ['', '  '], recipient: ['Одна фраза', 'Одна фраза'] }, { storage: () => undefined });
  assert.equal(pick('reviewer', 1), 'Оценки обсуждаются');
  for (let i = 0; i < 4; i++) assert.equal(pick('recipient', 2), 'Одна фраза');
});
