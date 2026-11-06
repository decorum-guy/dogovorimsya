import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Plus, Copy, Check, Link, ShieldCheck, Ban, LockKeyhole } from 'lucide-react';
import type { Bootstrap, Role } from '../../shared/types';
import { api, json } from '../lib/api';
import { Spinner, dateLabel } from './ui';

interface AccessState {
  users: { id: number; name: string; login: string; role: Role }[];
  codes: { id: string; role: Role; userId: number | null; createdAt: string; claimedAt: string | null; lastUsedAt: string | null; revokedAt: string | null; expiresAt: number | null }[];
}
export function Admin({ data }: { data: Bootstrap }) {
  const [state, setState] = useState<AccessState | null>(null), [target, setTarget] = useState(() => String(data.users.find(u => u.role === 'recipient')?.id || 'invite'));
  const [issued, setIssued] = useState<{ code: string; purpose: string } | null>(null), [copied, setCopied] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  async function refresh() { setState(await api<AccessState>('/api/admin/access')); }
  useEffect(() => { void refresh().catch(e => setError((e as Error).message)); }, []);
  async function issue() {
    setBusy(true); setError(''); setMessage(''); setIssued(null);
    try { const result = await api<{ code: string; purpose: string }>('/api/admin/codes', json('POST', { userId: target === 'invite' ? null : Number(target) })); setIssued(result); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function copy(value: string, kind: string) { try { await navigator.clipboard.writeText(value); setCopied(kind); } catch { setError('Не получилось скопировать автоматически. Выдели код и скопируй вручную.'); } }
  async function resetPassword(event: FormEvent<HTMLFormElement>, userId: number) {
    event.preventDefault(); const form = event.currentTarget, fields = new FormData(form);
    if (fields.get('password') !== fields.get('confirm')) { setError('Пароли не совпали.'); return; }
    setBusy(true); setError(''); setMessage('');
    try { await api(`/api/admin/users/${userId}/password`, json('POST', { password: fields.get('password') })); form.reset(); setMessage('Пароль изменён. Пользователь сможет войти с новым паролем или своим действующим кодом.'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="admin-page profiles-page"><p className="eyebrow">ФЕЙС-КОНТРОЛЬ ВАШЕГО ДУРДОМА</p><h1>Свои? Проходите, котики.</h1><p className="page-subtitle">Два места в космосе. Ни одного для случайного чёрта.</p>
    <div className="access-panel"><div className="access-panel-heading"><span className="stat-icon lilac"><KeyRound size={21}/></span><div><h2>Код доступа</h2><p>Один код — один аккаунт. После регистрации он подходит для восстановления.</p></div></div>
      <label>Для кого?<select value={target} onChange={e => { setTarget(e.target.value); setIssued(null); setCopied(''); }} disabled={busy}>{!data.users.some(u => u.role === 'recipient') && <option value="invite">Приглашение для неё — новый аккаунт</option>}{data.users.map(user => <option value={user.id} key={user.id}>{user.name} — восстановление доступа</option>)}</select></label>
      <p className="access-help">Новый код заменит предыдущий код этого аккаунта. Приглашение можно активировать в течение 30 дней; после регистрации код действует до отзыва.</p><button className="primary-button" disabled={busy} onClick={issue}>{busy ? <Spinner/> : <Plus size={16}/>}Выдать код</button>
      {issued && <div className="issued-code"><p><ShieldCheck size={15}/>Код показан только сейчас. Сохрани его в надёжном месте.</p><label><span className="sr-only">Выданный код доступа</span><input readOnly value={issued.code} onFocus={e => e.currentTarget.select()} spellCheck={false}/></label><div><button className="secondary-button" onClick={() => copy(issued.code, 'code')}>{copied === 'code' ? <Check size={15}/> : <Copy size={15}/>}Скопировать код</button><button className="secondary-button" onClick={() => copy(`${location.origin}/#${issued.purpose === 'invite' ? 'invite' : 'recover'}=${encodeURIComponent(issued.code)}`, 'link')}>{copied === 'link' ? <Check size={15}/> : <Link size={15}/>}Скопировать ссылку</button></div><small>Код позволяет восстановить пароль. Передавай его только владельцу аккаунта.</small></div>}
    </div>
    <div className="access-panel"><h2>Выданные коды</h2>{!state ? <Spinner/> : state.codes.length ? <div className="access-code-list">{state.codes.map(code => { const expired = code.expiresAt !== null && code.expiresAt <= Date.now(); return <article key={code.id}><span className={`access-status ${code.revokedAt || expired ? 'inactive' : ''}`}/><div><strong>{code.userId ? state.users.find(u => u.id === code.userId)?.name || 'Аккаунт' : 'Приглашение для неё'}</strong><span>{code.revokedAt ? 'Отозван' : expired ? 'Истёк' : code.userId ? 'Код восстановления активен' : 'Ждёт регистрации'} · {dateLabel(code.createdAt)}{code.lastUsedAt ? ` · использован ${dateLabel(code.lastUsedAt)}` : ''}</span></div>{!code.revokedAt && !expired && <button className="secondary-button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await api(`/api/admin/codes/${code.id}/revoke`, { method: 'POST', body: '{}' }); setIssued(null); await refresh(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><Ban size={13}/>Отозвать</button>}</article>; })}</div> : <p className="quiet-note">Пока ни одного кода. Первый можно выдать чуть выше.</p>}</div>
    <div className="access-panel"><h2>Аккаунты</h2>{state?.users.map(user => <div className="admin-user" key={user.id}><header><div><strong>{user.name}</strong><span>{user.login} · {user.role === 'reviewer' ? 'автор и администратор' : 'получатель оценок'}</span></div>{user.id === data.user.id && <small>это ты</small>}</header>{user.id !== data.user.id && <details><summary><LockKeyhole size={14}/>Изменить пароль</summary><form onSubmit={e => resetPassword(e, user.id)}><label>Новый пароль<input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={256} placeholder="Не меньше 12 символов"/></label><label>Повтори пароль<input name="confirm" type="password" autoComplete="new-password" required minLength={12} maxLength={256}/></label><p className="access-help">Все текущие входы этого пользователя завершатся.</p><button className="primary-button" disabled={busy}>{busy ? <Spinner/> : <Check size={15}/>}Сохранить пароль</button></form></details>}</div>)}</div>
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="success-message" role="status">{message}</p>}
  </section>;
}
