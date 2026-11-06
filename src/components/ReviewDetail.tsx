import { useCallback, useState } from 'react';
import { PencilLine, History, ArrowRight, X, ChevronLeft, ChevronRight, Star } from 'lucide-react';
import type { Bootstrap, CommentPhoto, Review, ReviewComment } from '../../shared/types';
import type { Save } from '../App';
import { json } from '../lib/api';
import { Modal, Avatar, Stars, mediaUrl, dateLabel, noteDateLabel, score } from './ui';
import { getTone } from '../lib/ratings';
import { useDraftGuard } from '../lib/use-draft-guard';
import { useCommentUpdates } from '../lib/use-comment-updates';
import { lastRatingChange } from '../../shared/review-history';
import { CommentComposer, emptyComposer, type ComposerState } from './CommentComposer';

export function ReviewDetail({ review: r, data, save, refresh, onClose, onEdit }: {
  review: Review; data: Bootstrap; save: Save; refresh: () => Promise<void>; onClose: () => void; onEdit: () => void;
}) {
  const [tab, setTab] = useState<'comments' | 'history'>('comments');
  const [error, setError] = useState(''), [actionBusy, setActionBusy] = useState(false);
  const [editing, setEditing] = useState<ReviewComment | null>(null);
  const [photo, setPhoto] = useState<number | null>(null), [viewPhotos, setViewPhotos] = useState<CommentPhoto[]>([]);
  const [createState, setCreateState] = useState(emptyComposer), [editState, setEditState] = useState(emptyComposer);
  const creatingChanged = useCallback((state: ComposerState) => setCreateState(state), []);
  const editingChanged = useCallback((state: ComposerState) => setEditState(state), []);
  const busy = actionBusy || createState.busy || editState.busy;
  const dirty = createState.dirty || editState.dirty;
  const requestClose = useDraftGuard(dirty, busy, onClose);
  const ratingChange = lastRatingChange(r);
  useCommentUpdates(r, tab === 'comments' && photo === null, refresh);
  function showPhotos(photos: CommentPhoto[], index: number) { setViewPhotos(photos); setPhoto(index); }
  function startEdit(comment: ReviewComment) {
    if (editState.dirty && !window.confirm('В другом комментарии остались несохранённые изменения. Перейти и потерять их?')) return;
    setEditState(emptyComposer); setEditing(comment);
  }
  async function act(operation: () => Promise<void>) {
    setActionBusy(true); setError('');
    try { await operation(); } catch (error) { setError((error as Error).message); }
    finally { setActionBusy(false); }
  }
  return <Modal title={r.title} eyebrow={'ВАША ИСТОРИЯ · ' + noteDateLabel(r.eventDate, r.eventTime, true)} onClose={requestClose} closeDisabled={busy}>
    <div className="review-detail">
      {photo !== null && <div className="lightbox">
        <button className="icon-button" aria-label="Закрыть фотографию" onClick={() => setPhoto(null)}><X/></button>
        <img src={mediaUrl(viewPhotos[photo].id)} alt={viewPhotos[photo].caption || 'Фотография ' + (photo + 1) + ' из ' + viewPhotos.length}/>
        {viewPhotos[photo].caption && <p className="lightbox-caption">{viewPhotos[photo].caption}</p>}
        {viewPhotos.length > 1 && <div className="lightbox-controls">
          <button className="icon-button" aria-label="Предыдущее фото" onClick={() => setPhoto((photo + viewPhotos.length - 1) % viewPhotos.length)}><ChevronLeft/></button>
          <span>{photo + 1} / {viewPhotos.length}</span>
          <button className="icon-button" aria-label="Следующее фото" onClick={() => setPhoto((photo + 1) % viewPhotos.length)}><ChevronRight/></button>
        </div>}
      </div>}
      <div className="review-detail-content" hidden={photo !== null}>
        <div className={'detail-rating tone-' + getTone(r.rating)}>
          <div><strong>{score(r.rating)}</strong><Stars rating={r.rating}/></div>
          {r.revisions.length > 1 && <button onClick={() => setTab('history')}><History size={14}/>
            {ratingChange ? <><s>{score(ratingChange.from)}</s><ArrowRight size={12}/>{score(ratingChange.to)} · изменено</> : <>Запись обновлена</>}
          </button>}
          {data.user.role === 'reviewer' && <button className="secondary-button" disabled={busy} onClick={() => {
            if (!dirty || window.confirm('В обсуждении остались несохранённые текст или фото. Перейти к редактированию отзыва и потерять их?')) onEdit();
          }}><PencilLine size={15}/>Изменить</button>}
        </div>
        <button className={'detail-favorite secondary-button' + (r.favorite ? ' active' : '')}
          aria-label={r.favorite ? 'Убрать из избранного' : 'Добавить в избранное'} aria-pressed={r.favorite} disabled={busy}
          onClick={() => { void act(() => save('/api/reviews/' + r.id + '/favorite', json('PUT', { favorite: !r.favorite }))); }}>
          <Star size={17} fill={r.favorite ? 'currentColor' : 'none'}/>{r.favorite ? 'Припрятано в сердечке' : 'Припрятать в сердечко'}
        </button>
        <p className="detail-body">{r.body}</p>
        {r.photoIds.length > 0 && <div className="detail-photos">{r.photoIds.map((id, index) =>
          <button key={id} onClick={() => showPhotos(r.photoIds.map(id => ({ id, caption: '' })), index)} aria-label={'Открыть фотографию ' + (index + 1)}>
            <img src={mediaUrl(id)} alt={'Фотография момента ' + (index + 1)}/>
          </button>)}</div>}
        <div className="detail-reactions">{['❤️', '🔥', '😂', '🥺'].map(emoji =>
          <button key={emoji} aria-label={'Реакция ' + emoji} aria-pressed={r.reactions.some(value => value.userId === data.user.id && value.emoji === emoji)}
            disabled={busy} onClick={() => { void act(() => save('/api/reviews/' + r.id + '/reactions', json('PUT', {
              emoji, active: !r.reactions.some(value => value.userId === data.user.id && value.emoji === emoji),
            }))); }}>{emoji}<span>{r.reactions.filter(value => value.emoji === emoji).length || ''}</span>
          </button>)}</div>
        <div className="detail-tabs">
          <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>Нежность и возражения <span>{r.comments.length}</span></button>
          <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><History size={14}/>История <span>{r.revisions.length}</span></button>
        </div>
        <section className="comment-panel" hidden={tab !== 'comments'}>
          <div className="comments">{r.comments.length ? r.comments.map(comment =>
            <div className="comment" key={comment.id}>
              <Avatar user={data.users.find(user => user.id === comment.userId)} small/>
              <div>
                <div className="comment-meta">
                  <strong>{data.users.find(user => user.id === comment.userId)?.name}</strong>
                  <span>{dateLabel(comment.createdAt, true)}{comment.revision > 1 || comment.updatedAt !== comment.createdAt ? ' · изменено' : ''}</span>
                  {comment.userId === data.user.id && editing?.id !== comment.id &&
                    <button className="icon-button" aria-label="Изменить свой комментарий" disabled={busy} onClick={() => startEdit(comment)}><PencilLine size={13}/></button>}
                </div>
                {editing?.id === comment.id ? <CommentComposer key={editing.id} editing initialBody={editing.body} initialPhotos={editing.photos}
                  disabled={actionBusy || createState.busy} onState={editingChanged}
                  onCancel={() => { setEditing(null); setEditState(emptyComposer); }}
                  onSave={async (body, photos) => {
                    await save('/api/comments/' + comment.id, json('PATCH', { body, photos, revision: editing.revision }));
                    setEditing(null); setEditState(emptyComposer);
                  }}/> : <>
                  {comment.body && <p>{comment.body}</p>}
                  {comment.photos.length > 0 && <div className="comment-photos">{comment.photos.map((item, index) =>
                    <figure key={item.id}>
                      <button type="button" aria-label={'Открыть фото из комментария ' + (index + 1)} onClick={() => showPhotos(comment.photos, index)}>
                        <img src={mediaUrl(item.id)} alt={item.caption || 'Фото к комментарию ' + (index + 1)} loading="lazy" decoding="async"/>
                      </button>
                      {item.caption && <figcaption>{item.caption}</figcaption>}
                    </figure>)}</div>}
                </>}
              </div>
            </div>) : <p className="quiet-note">Пока тихо. Можешь сказать «мур». Можешь — «ну блядь».</p>}
          </div>
          <div className="comment-form"><Avatar user={data.user} small/>
            <CommentComposer onState={creatingChanged} disabled={actionBusy || editState.busy}
              placeholder={data.user.role === 'recipient' ? 'Ваша честь, вы охуели. А теперь по пунктам…' : 'Обнять словами? Возразить с огоньком? Твой ход…'}
              onSave={async (body, photos) => { await save('/api/reviews/' + r.id + '/comments', json('POST', { body, photos })); }}/>
          </div>
        </section>
        {tab === 'history' && <div className="revision-list">{[...r.revisions].reverse().map((version, index) =>
          <article key={version.id}><span className="revision-dot"/>
            <header><strong>{score(version.rating)} <span>/ 5</span></strong><span>{dateLabel(version.createdAt, true)} · {index === r.revisions.length - 1 ? 'Первая версия' : 'Пересмотрено'}</span></header>
            <h4>{version.title}</h4><p>{version.body}</p>
            {version.photoIds.length > 0 && <div className="revision-photos">{version.photoIds.map(id =>
              <a key={id} href={mediaUrl(id)} target="_blank" rel="noreferrer"><img src={mediaUrl(id)} alt="Фото в этой версии"/></a>)}</div>}
            {version.note && <blockquote>{version.note}</blockquote>}
            <small>Дата записки: {noteDateLabel(version.eventDate, version.eventTime, true)}</small>
          </article>)}</div>}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </Modal>;
}
