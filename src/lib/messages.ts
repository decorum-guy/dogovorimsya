import messages from '../../content/homeMessages.json';
import type { Role } from '../../shared/types';

export function chooseHomeMessage(role: Role, userId: number) {
  const pool: string[] = messages[role].filter(text => text.trim());
  if (!pool.length) return 'Оценки обсуждаются';
  const key = `dogovorimsya:last-message:${userId}`;
  let last = '';
  try { last = localStorage.getItem(key) || ''; } catch { /* Private browsing. */ }
  const choices = pool.length > 1 ? pool.filter(text => text !== last) : pool;
  const text = choices[Math.floor(Math.random() * choices.length)];
  try { localStorage.setItem(key, text); } catch { /* Storage is optional. */ }
  return text;
}
