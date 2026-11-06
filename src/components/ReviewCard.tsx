import { MessageCircle, History, Flame, Sparkles, Heart, Star, Smile, ArrowUpRight } from 'lucide-react';
import type { Review, User } from '../../shared/types';
import { Avatar, Stars, dateLabel, mediaUrl, score } from './ui';
import { DevilHeart } from './Artwork';
import { getTone, toneNames } from '../lib/ratings';

interface Props {
  review: Review;
  author?: User;
  currentUserId?: number;
  onOpen?: () => void;
  onFavorite?: () => void;
  onReact?: (emoji: string) => void;
  specimen?: boolean;
}
export function ReviewCard({ review: r, author, currentUserId, onOpen, onFavorite, onReact, specimen = false }: Props) {
  const tone = getTone(r.rating), variant = r.designVariant || 0;
  const changed = r.revisions.length > 1;
  const original = r.revisions[0]?.rating;
  const Icon = tone === 'inferno' || tone === 'ember' ? Flame : Sparkles;
  const liked = r.reactions.some(reaction => reaction.userId === currentUserId && reaction.emoji === '❤️');
  return <article className={`review-card tone-${tone} detail-${variant} ${r.photoIds.length ? 'has-photo' : ''} ${specimen ? 'specimen' : ''}`}>
    <span className="paper-tape" aria-hidden="true"/>
    <div className="card-decoration" aria-hidden="true">
      <span className="motif-main">{tone === 'inferno' ? <DevilHeart/> : <Heart/>}</span>
      <span className="motif-heart"><Heart/></span>
      <span className="motif-sparkle"><Star/></span>
      <span className="motif-smile"><Smile/></span>
      <span className="motif-dots">· · ·</span>
    </div>
    <div className="card-top"><span className="card-category"><Icon size={13}/>{toneNames[tone]}</span>{onFavorite && <button className={`icon-button favorite-toggle ${r.favorite ? 'active' : ''}`} title={r.favorite ? 'В твоём избранном' : 'Сохранить в твоё избранное'} aria-label={r.favorite ? 'Убрать из избранного' : 'Добавить в избранное'} aria-pressed={r.favorite} onClick={onFavorite}><Star size={19} fill={r.favorite ? 'currentColor' : 'none'}/></button>}</div>
    {r.photoIds.length > 0 && <button className="card-photo" onClick={onOpen} aria-label={`Открыть отзыв «${r.title}»`}><img src={mediaUrl(r.photoIds[0])} alt="Фотография момента" loading="lazy"/>{r.photoIds.length > 1 && <span>+{r.photoIds.length - 1}</span>}</button>}
    <div className="card-main">
      <div className="rating-row"><strong className="rating">{score(r.rating)}<span>/ 5</span></strong><div className="rating-meta"><Stars rating={r.rating}/>{changed ? <span className="edited"><History size={11}/><s>{score(original!)}</s><span>→ {score(r.rating)}</span></span> : <span className="rating-caption">{tone === 'inferno' ? 'любовь выдержит' : tone === 'gold' ? 'ни одной претензии' : 'всё по-честному'}</span>}</div>{tone === 'inferno' && <span className="fire-sign" aria-hidden="true">🔥</span>}</div>
      <h3>{onOpen ? <button onClick={onOpen}>{r.title}</button> : r.title}</h3>
      <p className="card-body">{r.body}</p>
      {tone === 'inferno' && <div className="hell-stamp"><Flame size={13}/>ПОЛЫХАЕТ, НО ЛЮБЛЮ</div>}
    </div>
    <div className="card-footer"><span className="card-byline">{author && <Avatar user={author} small/>}<time dateTime={r.eventDate}>{dateLabel(r.eventDate)}</time>{changed && <span className="edited-word">· изменено</span>}</span><div className="card-actions">{onReact ? <button className={`reaction-button ${liked ? 'active' : ''}`} aria-label="Реакция: сердечко" aria-pressed={liked} onClick={() => onReact('❤️')}><Heart size={15} fill={liked ? 'currentColor' : 'none'}/>{r.reactions.filter(v => v.emoji === '❤️').length || ''}</button> : <Heart size={15}/>}<button onClick={onOpen} className="comment-count" aria-label={`Обсудить: ${r.comments.length} комментариев`} disabled={!onOpen}><MessageCircle size={15}/>{r.comments.length || (specimen ? 'обсудим?' : '')}</button>{onOpen && <button onClick={onOpen} className="icon-button card-arrow" aria-label="Открыть отзыв"><ArrowUpRight size={16}/></button>}</div></div>
  </article>;
}
