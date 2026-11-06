import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { PullGesture, pullThreshold } from '../lib/pull-gesture';

export function PullToRefresh({ enabled, refreshing, onRefresh, children }: {
  enabled: boolean; refreshing: boolean; onRefresh: () => Promise<void>; children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null), refresh = useRef(onRefresh), running = useRef(refreshing);
  refresh.current = onRefresh; running.current = refreshing;
  const [pull, setPull] = useState({ distance: 0, dragging: false });
  useEffect(() => {
    const element = root.current;
    if (!enabled || !element) { setPull({ distance: 0, dragging: false }); return; }
    const gesture = new PullGesture();
    let mounted = true;
    function start(event: TouchEvent) {
      gesture.cancel();
      if (running.current || event.target instanceof Element && event.target.closest('input,textarea,select,[contenteditable],[data-no-pull-refresh]')) return;
      const point = event.touches[0];
      if (point) gesture.begin(point.clientX, point.clientY, Math.max(0, window.scrollY), event.touches.length);
    }
    function move(event: TouchEvent) {
      const point = event.touches[0];
      if (!point) return;
      const distance = gesture.move(point.clientX, point.clientY, event.touches.length);
      if (distance === null) { setPull(previous => previous.distance || previous.dragging ? { distance: 0, dragging: false } : previous); return; }
      if (event.cancelable) event.preventDefault();
      setPull({ distance, dragging: true });
    }
    function end() {
      const triggered = gesture.release();
      setPull({ distance: triggered ? 56 : 0, dragging: false });
      if (triggered && !running.current) {
        running.current = true;
        void refresh.current().catch(() => {}).finally(() => { if (mounted) setPull({ distance: 0, dragging: false }); });
      }
    }
    function cancel() { gesture.cancel(); setPull({ distance: 0, dragging: false }); }
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', cancel);
    return () => {
      mounted = false; gesture.cancel();
      element.removeEventListener('touchstart', start); element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end); element.removeEventListener('touchcancel', cancel);
    };
  }, [enabled]);
  const distance = pull.distance, visible = distance > 0;
  return <div ref={root} className={'pull-refresh-root' + (pull.dragging ? ' pulling' : '')}>
    <div className="pull-refresh-indicator" role="status" aria-live="polite" aria-hidden={!visible}
      style={{ opacity: visible ? 1 : 0, transform: 'translateY(' + (distance - 56) + 'px)' }}>
      <RefreshCw size={18} className={refreshing ? 'spin' : ''} style={refreshing ? undefined : { transform: 'rotate(' + Math.min(distance / pullThreshold, 1) * 180 + 'deg)' }}/>
      <span>{refreshing ? 'Обновляем вашу вселенную…' : distance >= pullThreshold ? 'Отпускай — обновим ♡' : 'Потяни ещё чуть-чуть…'}</span>
    </div>
    <div className="pull-refresh-content" style={distance ? { transform: 'translateY(' + distance + 'px)' } : undefined}>{children}</div>
  </div>;
}
