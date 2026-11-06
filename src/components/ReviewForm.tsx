import { useRef, useState, type FormEvent } from 'react';
import { Star, Minus, Plus, ImagePlus, X, Flame, Check, CalendarDays } from 'lucide-react';
import type { Review } from '../../shared/types';
import type { Save } from '../App';
import { json, uploadPhotos } from '../lib/api';
import { getTone, toneNames, toneVoice } from '../lib/ratings';
import { Modal, Spinner, mediaUrl, score } from './ui';
import { readRating } from '../lib/rating-input';
import { useDraftGuard } from '../lib/use-draft-guard';

export function ReviewForm({ review, save, onClose, onSaved }: { review?: Review; save: Save; onClose: () => void; onSaved: () => void }) {
  const [rating, setRating] = useState(review?.rating ?? 50), [title, setTitle] = useState(review?.title || ''), [body, setBody] = useState(review?.body || '');
  const [eventDate, setEventDate] = useState(review?.eventDate || ''), [photos, setPhotos] = useState(review?.photoIds || []), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState('');
  const submitting = useRef(false);
  const [ratingText, setRatingText] = useState(score(review?.rating ?? 50)), [ratingTouched, setRatingTouched] = useState(false);
  const parsedRating = readRating(ratingText);
  const dirty = title !== (review?.title || '') || body !== (review?.body || '') || ratingText !== score(review?.rating ?? 50)
    || eventDate !== (review?.eventDate || '') || JSON.stringify(photos) !== JSON.stringify(review?.photoIds || []) || Boolean(note.trim());
  const requestClose = useDraftGuard(dirty, busy || uploading, onClose);
  function selectRating(value: number) { setRating(value); setRatingText(score(value)); setRatingTouched(false); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || uploading) return;
    if (parsedRating === null) { setRatingTouched(true); setError('Введи оценку от 0 до 5 с одной цифрой после запятой. Например, 4,9.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try { await save(review ? `/api/reviews/${review.id}` : '/api/reviews', json(review ? 'PATCH' : 'POST', { rating: parsedRating, title, body, photoIds: photos, note, ...(review ? { eventDate, revision: review.revision } : {}) })); onSaved(); }
    catch (error) { setError((error as Error).message); } finally { submitting.current = false; setBusy(false); }
  }
  return <Modal title={review ? 'Так, сюжетный поворот.' : 'Милота или место преступления?'} eyebrow={review ? 'ПАМЯТЬ КАК У ЗЛОПАМЯТНОГО КОТИКА' : 'ОТДЕЛ НЕЖНОСТИ И ОСОБОГО БЕСПРЕДЕЛА'} onClose={requestClose} closeDisabled={busy || uploading}><form className="review-form" onSubmit={submit}><fieldset className="form-fields" disabled={busy}>
    <div className={`rating-picker tone-${getTone(rating)}`}><p>{toneNames[getTone(rating)]}{rating < 20 && <Flame size={16}/>}</p><div className="number-picker"><button type="button" className="icon-button" aria-label="Уменьшить оценку на 0.1" onClick={() => selectRating(Math.max(0, rating - 1))}><Minus size={20}/></button><label><input aria-label="Оценка от 0 до 5" type="text" inputMode="decimal" required maxLength={4} value={ratingText} aria-invalid={ratingTouched && parsedRating === null} onChange={e => { const text = e.target.value; setRatingText(text); const value = readRating(text); if (value !== null) setRating(value); }} onBlur={() => { setRatingTouched(true); if (parsedRating !== null) selectRating(parsedRating); }}/><span>из 5</span></label><button type="button" className="icon-button" aria-label="Увеличить оценку на 0.1" onClick={() => selectRating(Math.min(50, rating + 1))}><Plus size={20}/></button></div><div className="star-picker">{[1, 2, 3, 4, 5].map(n => <button type="button" key={n} aria-label={`Поставить ${n}`} onClick={() => selectRating(n * 10)}><Star size={27} fill={rating >= n * 10 ? 'currentColor' : 'none'}/></button>)}</div><input aria-label="Выбрать оценку с шагом 0.1" type="range" min={0} max={50} step={1} value={rating} onChange={e => selectRating(Number(e.target.value))}/><small>{toneVoice[getTone(rating)].hint}</small></div>
    <label>Как назовём этот момент?<input required maxLength={140} value={title} onChange={e => setTitle(e.target.value)} placeholder="Например, «Моя булочка захватила одеяло»"/></label><label>Твоя версия событий<textarea required rows={4} maxLength={10000} value={body} onChange={e => setBody(e.target.value)} placeholder="Хронология милоты, масштаб пиздеца, показания чайника. Что было на самом деле?"/></label>
    {review ? <label><span className="label-with-icon"><CalendarDays size={15}/>Дата записки</span><input required type="date" value={eventDate} onChange={e => setEventDate(e.target.value)}/></label> : <p className="quiet-note label-with-icon"><CalendarDays size={15}/>Дату поставим при публикации. Потом её можно изменить.</p>}
    <div className="photo-field"><div><strong>{toneVoice[getTone(rating)].photos}</strong><span>{photos.length}/5 фотографий</span></div><div className="photo-previews">{photos.map(id => <div key={id}><img src={mediaUrl(id)} alt="Прикреплённое фото"/><button type="button" className="icon-button" aria-label="Убрать фотографию" onClick={() => setPhotos(photos.filter(photo => photo !== id))}><X size={14}/></button></div>)}{photos.length < 5 && <label className={`upload-tile ${uploading ? 'disabled' : ''}`}>{uploading ? <Spinner/> : <ImagePlus size={24}/>}<span>{uploading ? 'Загружаем…' : 'Добавить фото'}</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif" multiple disabled={uploading || busy} onChange={async e => { const files = Array.from(e.target.files || []); e.target.value = ''; if (!files.length) return; if (files.length + photos.length > 5) { setError('У одного момента может быть до пяти фотографий.'); return; } setError(''); setUploading(true); try { const ids = await uploadPhotos(files, 'photo'); setPhotos(previous => [...previous, ...ids]); } catch (error) { setError((error as Error).message); } finally { setUploading(false); } }}/></label>}</div><small>До 16 МБ на фото. Геометки удаляются при загрузке.</small></div>
    {review && <label>Почему меняешь? <span className="optional">необязательно</span><textarea rows={2} maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="Передумал? Нашлись улики? Вспомнил её сонное «мур»?"/></label>}{error && <p className="form-error" role="alert">{error}</p>}<div className="form-actions"><button type="button" className="secondary-button" onClick={requestClose} disabled={busy || uploading}>Пока не ставить</button><button className="primary-button" disabled={busy || uploading}>{busy ? <Spinner/> : <Check size={17}/>} {review ? 'Сохранить изменения' : 'Зафиксировать беспредел'}</button></div>
  </fieldset></form></Modal>;
}
