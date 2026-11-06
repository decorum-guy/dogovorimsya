import { useEffect, useState, type FormEvent } from 'react';
import { Heart, LockKeyhole, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { api, json } from '../lib/api';
import { Brand, Spinner } from './ui';
import { LoveLetter } from './Artwork';

type Mode = 'login' | 'register' | 'recover';
export function Login({ demo, onLogin }: { demo: boolean; onLogin: () => Promise<void> }) {
  const fragment = new URLSearchParams(location.hash.slice(1));
  const [mode, setMode] = useState<Mode>(() => fragment.has('invite') ? 'register' : fragment.has('recover') ? 'recover' : 'login');
  const [code, setCode] = useState(() => (fragment.get('invite') || fragment.get('recover') || '').slice(0, 100));
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => {
    const consumeCodeLink = () => {
      const params = new URLSearchParams(location.hash.slice(1));
      const invitation = params.get('invite'), recovery = params.get('recover');
      if (invitation || recovery) {
        setMode(invitation ? 'register' : 'recover');
        setCode((invitation || recovery || '').slice(0, 100));
        setError('');
        history.replaceState(null, '', location.pathname + location.search);
      }
    };
    consumeCodeLink();
    window.addEventListener('hashchange', consumeCodeLink);
    return () => window.removeEventListener('hashchange', consumeCodeLink);
  }, []);
  function changeMode(next: Mode) { setMode(next); setError(''); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const form = new FormData(event.currentTarget);
    if (mode !== 'login' && form.get('password') !== form.get('confirm')) { setError('Пароли не совпали. Попробуем ещё раз?'); return; }
    setBusy(true);
    try {
      const body = mode === 'login' ? { login: form.get('login'), password: form.get('password') }
        : mode === 'register' ? { code, login: form.get('login'), name: form.get('name'), password: form.get('password') }
        : { code, password: form.get('password') };
      await api(mode === 'login' ? '/api/login' : mode === 'register' ? '/api/register' : '/api/recover', json('POST', body));
      setCode(''); await onLogin();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  const titles = { login: 'Ну что, в наш дурдом?', register: 'Заходи, космическая.', recover: 'Вернём ключ от галактики.' };
  const descriptions = { login: 'Два своих человека. Ноль посторонних. Охуенно устроились.', register: 'Код от него. Рожки, нимб и любимое «мур» — от тебя.', recover: 'Тот самый код приглашения подойдёт и здесь.' };
  return <div className="login-page"><div className="login-story"><Brand/><div><span className="eyebrow">ОДНА ИСТОРИЯ. ДВЕ ВЕРСИИ СОБЫТИЙ.</span><h1>Любовь вне рейтинга.<br/><em>Оценки обсуждаются.</em></h1><LoveLetter/><p>Маленькие котики. Большой характер.<br/>От «обожаю» до «ну какого хрена» — одна вкладка.</p></div><small><LockKeyhole size={13}/>Только для вас двоих</small></div><main className="login-form-wrap"><div className="mobile-brand"><Brand/></div><form key={mode} className="login-form" onSubmit={submit}>
    <span className="tiny-heart"><Heart size={25}/></span><p className="eyebrow">СЕКРЕТНЫЙ БУНКЕР ДЛЯ ДВОИХ</p><h2>{titles[mode]}</h2><p>{descriptions[mode]}</p>
    {mode !== 'recover' && <div className="login-tabs"><button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => changeMode('login')}>Войти</button><button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => changeMode('register')}>У меня есть приглашение</button></div>}
    {mode !== 'login' && <label>Код {mode === 'register' ? 'приглашения' : 'восстановления'}<input className="access-code-input" name="code" value={code} onChange={e => setCode(e.target.value)} required maxLength={100} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="DG-…"/></label>}
    {mode === 'register' && <label>Как тебя называть?<input name="name" required maxLength={50} autoComplete="given-name" placeholder="Твоё имя"/></label>}
    {mode !== 'recover' && <label>Логин<input name="login" autoComplete="username" required minLength={mode === 'register' ? 3 : 1} maxLength={mode === 'register' ? 40 : 100} pattern={mode === 'register' ? '[a-zA-Z0-9_.-]{3,40}' : undefined} title={mode === 'register' ? 'Латинские буквы, цифры, точка, дефис или подчёркивание' : undefined} placeholder={mode === 'register' ? 'Латиницей, от 3 символов' : 'Твой логин'} autoCapitalize="none" autoCorrect="off"/></label>}
    <label>{mode === 'recover' ? 'Новый пароль' : 'Пароль'}<input name="password" type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 12} maxLength={256} placeholder={mode === 'login' ? 'Маленький секрет' : 'Не меньше 12 символов'}/></label>
    {mode !== 'login' && <label>Повтори пароль<input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={256} required placeholder="Чтобы без недоразумений"/></label>}
    {error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? <Spinner/> : <>{mode === 'register' ? 'Начать нашу историю' : mode === 'recover' ? 'Сохранить пароль и войти' : 'Открыть нашу историю'}<ArrowUpRight size={18}/></>}</button>
    <div className="login-links">{mode === 'login' ? <button type="button" className="text-button" onClick={() => changeMode('recover')}>Забыли пароль? Есть код.</button> : <button type="button" className="text-button" onClick={() => changeMode(mode === 'recover' ? 'login' : 'recover')}>{mode === 'recover' ? 'Вернуться ко входу' : 'Аккаунт уже есть? Восстановить доступ'}</button>}</div>
    <small className="login-note"><ShieldCheck size={14}/>{mode === 'register' ? 'Сохрани код: он поможет восстановить доступ.' : 'Посторонним — в другую галактику. Своим — под плед.'}</small>
    {demo && mode === 'login' && <div className="demo-login"><p>Демонстрация · вымышленные записи</p>{(['reviewer', 'recipient'] as const).map(role => <button type="button" key={role} onClick={async () => { try { setBusy(true); await api('/api/demo/login', json('POST', { role })); await onLogin(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }} disabled={busy}>{role === 'reviewer' ? 'Я автор оценок' : 'Мне ставят оценки'}</button>)}</div>}
  </form></main></div>;
}
