import type { Role } from '../../shared/types';

type Pools = Record<Role, readonly string[]>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
interface Cycle { format: 1; poolId: string; remaining: number[]; last: string }
interface Options { storage?: () => StorageLike | undefined; random?: () => number }
export const messageCycleKey = (role: Role, userId: number) => `dogovorimsya:message-cycle:${role}:${userId}`;

function poolId(pool: string[]) {
  let hash = 2166136261;
  for (const character of pool.join('\u0000')) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${pool.length}:${(hash >>> 0).toString(36)}`;
}
function validQueue(value: unknown, size: number): value is number[] {
  return Array.isArray(value) && value.length <= size && new Set(value).size === value.length
    && value.every(index => Number.isInteger(index) && index >= 0 && index < size);
}

// A shuffled bag per account. Only public phrase indices enter localStorage.
export function createMessagePicker(pools: Pools, options: Options = {}) {
  const random = options.random || Math.random;
  const getStorage = options.storage || (() => globalThis.localStorage);
  const memory = new Map<string, Cycle>();
  let storageBlocked = false;

  return function choose(role: Role, userId: number): string {
    const pool = [...new Set(pools[role].filter(text => text.trim()))];
    if (!pool.length) return 'Оценки обсуждаются';
    const key = messageCycleKey(role, userId), signature = poolId(pool);
    let previous: Partial<Cycle> | undefined = memory.get(key);
    let storage: StorageLike | undefined;
    let legacyLast = '';
    if (!storageBlocked) {
      try {
        storage = getStorage();
        const raw = storage?.getItem(key);
        if (raw) {
          try {
            const parsed: unknown = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) previous = parsed as Partial<Cycle>;
          } catch { /* A damaged cache starts a new cycle. */ }
        }
        legacyLast = storage?.getItem(`dogovorimsya:last-message:${userId}`) || '';
      } catch { storageBlocked = true; storage = undefined; }
    }
    const last = typeof previous?.last === 'string' ? previous.last : legacyLast;
    let remaining = previous?.format === 1 && previous.poolId === signature && validQueue(previous.remaining, pool.length)
      && previous.remaining.every(index => pool[index] !== last)
      ? [...previous.remaining] : [];

    if (!remaining.length) {
      remaining = pool.map((_, index) => index);
      for (let i = remaining.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      }
      // Avoid repeating the final phrase of the previous cycle at the boundary.
      if (remaining.length > 1 && pool[remaining[0]] === last) [remaining[0], remaining[1]] = [remaining[1], remaining[0]];
    }
    const phrase = pool[remaining.shift()!];
    const cycle: Cycle = { format: 1, poolId: signature, remaining, last: phrase };
    memory.set(key, cycle);
    try { storage?.setItem(key, JSON.stringify(cycle)); }
    catch { storageBlocked = true; }
    return phrase;
  };
}
