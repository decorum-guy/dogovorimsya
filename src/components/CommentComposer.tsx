import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, ImagePlus, Send, X } from 'lucide-react';
import type { CommentPhoto } from '../../shared/types';
import { uploadPhotos } from '../lib/api';
import { mediaUrl, Spinner } from './ui';

export type ComposerState = { dirty: boolean; busy: boolean };
export const emptyComposer: ComposerState = { dirty: false, busy: false };

export function CommentComposer({ initialBody = '', initialPhotos = [], editing = false, placeholder, disabled,
  onSave, onCancel, onState }: {
  initialBody?: string; initialPhotos?: CommentPhoto[]; editing?: boolean; placeholder?: string; disabled?: boolean;
  onSave: (body: string, photos: CommentPhoto[]) => Promise<void>; onCancel?: () => void;
  onState: (state: ComposerState) => void;
}) {
  const [body, setBody] = useState(initialBody), [photos, setPhotos] = useState<CommentPhoto[]>(initialPhotos);
  const [busy, setBusy] = useState(false), [uploading, setUploading] = useState(false), [error, setError] = useState('');
  const locked = useRef(false);
  const dirty = body !== initialBody || JSON.stringify(photos) !== JSON.stringify(initialPhotos);
  useEffect(() => onState({ dirty, busy }), [dirty, busy, onState]);
  async function attach(files: File[]) {
    if (locked.current || disabled || !files.length) return;
    if (photos.length + files.length > 5) { setError('К комментарию можно прикрепить до пяти фотографий.'); return; }
    if (files.some(file => file.size > 16 * 1024 * 1024)) { setError('Каждая фотография должна быть не больше 16 МБ.'); return; }
    locked.current = true; setBusy(true); setUploading(true); setError('');
    try {
      const ids = await uploadPhotos(files, 'photo');
      setPhotos(previous => [...previous, ...ids.map(id => ({ id, caption: '' }))]);
    } catch (error) { setError((error as Error).message); }
    finally { locked.current = false; setBusy(false); setUploading(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (locked.current || disabled || !body.trim() && !photos.length) return;
    locked.current = true; setBusy(true); setError('');
    try {
      await onSave(body, photos);
      if (!editing) { setBody(''); setPhotos([]); }
    } catch (error) { setError((error as Error).message); }
    finally { locked.current = false; setBusy(false); }
  }
  return <form className={'comment-composer' + (editing ? ' editing' : '')} onSubmit={submit}>
    <label className="comment-text-label"><span className="sr-only">{editing ? 'Изменить текст комментария' : 'Твоя версия событий'}</span>
      <textarea disabled={busy || disabled} required={!photos.length} rows={2} maxLength={3000}
        value={body} onChange={event => setBody(event.target.value)} placeholder={placeholder || 'Текст, фото или всё сразу. Улики принимаются ♡'}/>
    </label>
    {photos.length > 0 && <div className="comment-attachment-editor">{photos.map((photo, index) =>
      <div className="comment-attachment" key={photo.id}>
        <div className="comment-attachment-preview"><img src={mediaUrl(photo.id)} alt={'Прикреплённая фотография ' + (index + 1)}/>
          <button type="button" className="icon-button" aria-label={'Убрать фото ' + (index + 1)} disabled={busy || disabled}
            onClick={() => setPhotos(previous => previous.filter(value => value.id !== photo.id))}><X size={15}/></button></div>
        <label>Подпись к фото {index + 1}<input type="text" maxLength={500} value={photo.caption} disabled={busy || disabled}
          placeholder="Что тут творится? ♡" onChange={event => {
            const caption = event.target.value;
            setPhotos(previous => previous.map(value => value.id === photo.id ? { ...value, caption } : value));
          }}/></label>
      </div>)}</div>}
    <div className="comment-composer-actions">
      <label className={'comment-attach-button' + (busy || disabled || photos.length >= 5 ? ' disabled' : '')}>
        {uploading ? <Spinner/> : <ImagePlus size={18}/>}<span>{uploading ? 'Загружаем фото…' : 'Добавить фото'}</span>
        <input type="file" aria-label={editing ? 'Добавить фотографии при редактировании комментария' : 'Добавить фотографии к комментарию'}
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif" multiple disabled={busy || disabled || photos.length >= 5}
          onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void attach(files); }}/>
      </label>
      <span className="comment-photo-count">{photos.length ? photos.length + '/5' : 'до 5 фото'}</span>
      {onCancel && <button type="button" className="secondary-button" disabled={busy} onClick={() => {
        if (!dirty || window.confirm('В комментарии остались несохранённые текст или фото. Отменить изменения?')) onCancel();
      }}>Отмена</button>}
      <button className="primary-button" aria-label={editing ? 'Сохранить комментарий' : 'Отправить комментарий'}
        disabled={busy || disabled || !body.trim() && !photos.length}>
        {busy && !uploading ? <Spinner/> : editing ? <Check size={17}/> : <Send size={17}/>}
        <span>{editing ? 'Сохранить' : 'Отправить'}</span>
      </button>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
  </form>;
}
