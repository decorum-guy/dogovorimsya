import { useEffect, useRef } from 'react';
import type { Review } from '../../shared/types';
import { commentVersion } from '../../shared/comments';
import { api, ApiError } from './api';

export function useCommentUpdates(review: Review, enabled: boolean, refresh: () => Promise<void>) {
  const currentVersion = useRef(''), currentRefresh = useRef(refresh);
  currentVersion.current = commentVersion(review.comments);
  currentRefresh.current = refresh;
  useEffect(() => {
    if (!enabled) return;
    let active = true, pending = false, controller: AbortController | undefined;
    async function check() {
      if (!active || pending || document.visibilityState !== 'visible') return;
      pending = true; controller = new AbortController();
      try {
        const result = await api<{ version: string }>('/api/reviews/' + review.id + '/comments/version', { signal: controller.signal });
        if (active && result.version !== currentVersion.current) await currentRefresh.current();
      } catch (error) {
        if (active && error instanceof ApiError && error.status === 401) await currentRefresh.current().catch(() => {});
      } finally { pending = false; }
    }
    void check();
    const timer = window.setInterval(() => { void check(); }, 5000);
    document.addEventListener('visibilitychange', check);
    return () => { active = false; controller?.abort(); window.clearInterval(timer); document.removeEventListener('visibilitychange', check); };
  }, [review.id, enabled]);
}
