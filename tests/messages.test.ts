import { test } from 'node:test';
import assert from 'node:assert/strict';
import messages from '../content/homeMessages.json';
import { chooseHomeMessage } from '../src/lib/messages.js';

test('the approved phrase pools remain separated, nonempty and do not immediately repeat per account', () => {
  const storage = new Map<string, string>();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value) } });
  try {
    assert.equal(messages.reviewer.length, 26); assert.equal(messages.recipient.length, 26);
    assert.ok(messages.recipient.includes('Обжалуй меня.'));
    for (const [role, id] of [['reviewer', 1], ['recipient', 2]] as const) {
      let last = '';
      for (let i = 0; i < 50; i++) { const phrase = chooseHomeMessage(role, id); assert.ok(messages[role].includes(phrase)); assert.notEqual(phrase, last); last = phrase; }
    }
    assert.equal(storage.size, 2);
  } finally { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});
