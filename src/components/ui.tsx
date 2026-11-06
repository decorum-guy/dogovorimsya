import { useEffect, useRef, useId, type ReactNode } from 'react';
import { Heart, Star, X, LoaderCircle } from 'lucide-react';
import type { User } from '../../shared/types';

export const mediaUrl = (id: string) => `/media/${id}`;
export const score = (rating: number) => (rating / 10).toFixed(1);
export function dateLabel(date: string, full = false) {
  return new Date(date.length === 10 ? `${date}T12:00:00` : date).toLocaleDateString('ru-RU', { day: 'numeric', month: full ? 'long' : 'short', ...(full ? { year: 'numeric' } : {}) });
}
export function noteDateLabel(date: string, time: string | null, full = false) {
  return dateLabel(date, full) + (time ? ` · ${time}` : '');
}
export function Avatar({ user, small = false }: { user?: User; small?: boolean }) {
  return <span className={`avatar ${small ? 'small' : ''} ${user?.role === 'recipient' ? 'rose' : 'plum'}`}>
    {user?.avatarId ? <img src={mediaUrl(user.avatarId)} alt={user.name} /> : user?.name?.slice(0, 1) || <Heart size={18} />}
  </span>;
}
export function Stars({ rating }: { rating: number }) {
  return <span className="stars" aria-label={`${score(rating)} из 5`}>
    {[0, 1, 2, 3, 4].map(i => <span className="star" key={i}><Star size={16} fill="currentColor"/><span style={{ width: `${Math.max(0, Math.min(10, rating - i * 10)) * 10}%` }}><Star size={16} fill="currentColor"/></span></span>)}
  </span>;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className={`brand ${compact ? 'compact' : ''}`}><span className="brand-icon"><Heart size={21} fill="currentColor" strokeWidth={1.5}/><span>✦</span></span><div><strong>Договоримся</strong><small>Оценки обсуждаются</small></div></div>;
}
export function Spinner() { return <LoaderCircle className="spin" size={19} aria-label="Загрузка" />; }
export function Modal({ title, eyebrow, children, onClose, wide = false, closeDisabled = false }: { title: string; eyebrow?: string; children: ReactNode; onClose: () => void; wide?: boolean; closeDisabled?: boolean }) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    document.body.classList.add('modal-open');
    return () => { dialog.close(); document.body.classList.remove('modal-open'); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close.current(); }} onClick={event => { if (event.target === event.currentTarget) close.current(); }}>
    <div className="modal-inner"><header className="modal-head"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 id={titleId}>{title}</h2></div><button className="icon-button" aria-label="Закрыть" disabled={closeDisabled} onClick={() => close.current()}><X size={22}/></button></header>{children}</div>
  </dialog>;
}
