import { useEffect, useState } from 'react';
import { Bell, BellOff, MoonStar, Radio, Send, Smartphone, VolumeX } from 'lucide-react';
import type { Role } from '../../shared/types';
import type { NotificationKind, NotificationPreferences, NotificationState } from '../../shared/notifications';
import { api, json } from '../lib/api';
import { currentSubscription, publicKeyBytes, supportsPush } from '../lib/push';
import { Spinner } from './ui';

function Toggle({ title, description, checked, disabled, onChange }: { title: string; description: string; checked: boolean; disabled: boolean; onChange: () => void }) {
  return <div className="notification-toggle"><div><strong>{title}</strong><p>{description}</p></div><button type="button" className="switch" role="switch" aria-label={title} aria-checked={checked} disabled={disabled} onClick={onChange}><span/></button></div>;
}
const events: { kind: NotificationKind; title: string; description: string; recipientOnly?: boolean }[] = [
  { kind: 'review_created', title: 'Новый отзыв', description: 'Тебе прилетели звёздочки. Или маленький метеорит.', recipientOnly: true },
  { kind: 'rating_changed', title: 'Изменение оценки', description: 'Десятые двигаются. Хроника охуительных поворотов.', recipientOnly: true },
  { kind: 'comment', title: 'Комментарии', description: 'Твой человек вышел на связь. Нежно или с аргументами.' },
  { kind: 'favorite', title: 'Добавление в избранное', description: 'Кто-то бережно спрятал ваш момент в сердечко.' },
  { kind: 'reaction', title: 'Реакции', description: 'Сердечки, огонь и прочие внеземные сигналы.' },
];
export function NotificationSettings({ role, demo }: { role: Role; demo: boolean }) {
  const [state, setState] = useState<NotificationState | null>(null), [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => supportsPush() ? Notification.permission : 'unsupported');
  const [now, setNow] = useState(Date.now());
  async function load() {
    const settings = await api<NotificationState>('/api/notifications');
    const subscription = await currentSubscription();
    setConnected(subscription ? (await api<{ connected: boolean }>('/api/notifications/device', json('POST', { endpoint: subscription.endpoint }))).connected : false);
    setState(settings); setPermission(supportsPush() ? Notification.permission : 'unsupported'); setNow(Date.now());
  }
  useEffect(() => {
    void load().catch(e => setError((e as Error).message));
    const onReturn = () => { if (document.visibilityState === 'visible') void load().catch(() => {}); };
    document.addEventListener('visibilitychange', onReturn);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { document.removeEventListener('visibilitychange', onReturn); window.clearInterval(timer); };
  }, []);
  async function save(preferences: NotificationPreferences) {
    setBusy(true); setError(''); setMessage('');
    try { await api('/api/notifications/preferences', json('PUT', preferences)); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function connect() {
    if (!state?.publicKey || !supportsPush()) return;
    // iOS requires this call in the direct click handler, before any await.
    setBusy(true); setError(''); setMessage('');
    try {
      const granted = await (Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission)); setPermission(granted);
      if (granted !== 'granted') throw new Error('Разрешение не включено. Можно вернуться к этому позже в настройках уведомлений устройства.');
      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription?.options.applicationServerKey && !Array.from(new Uint8Array(subscription.options.applicationServerKey)).every((byte, i) => byte === publicKeyBytes(state.publicKey!)[i])) { await subscription.unsubscribe(); subscription = null; }
      subscription ||= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKeyBytes(state.publicKey) });
      await api('/api/notifications/subscriptions', json('POST', subscription.toJSON()));
      await load(); setMessage('Связь установлена. Ваша маленькая галактика теперь умеет стучаться ♡');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError(''); setMessage('');
    try {
      const subscription = await currentSubscription();
      if (subscription) { await api('/api/notifications/subscriptions', json('DELETE', { endpoint: subscription.endpoint })); await subscription.unsubscribe(); }
      await load(); setMessage('На этом устройстве тихо. Уведомления можно подключить снова.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const prefs = state?.preferences;
  const paused = Boolean(prefs?.mutedUntil && prefs.mutedUntil > now);
  return <section className="notification-settings" aria-labelledby="notifications-title"><header className="notification-heading"><span className="notification-orbit"><Bell size={24}/><span>✦</span></span><div><p className="eyebrow">ЦЕНТР МЕЖДУСОБОЙЧИКОВОЙ СВЯЗИ</p><h2 id="notifications-title">Постучаться в твой космос.</h2><p>Чуть-чуть «эй, я тут». Громкость нежности выбираешь ты.</p></div></header>
    {!state && !error && <Spinner/>}
    {state && prefs && <>
      <div className="notification-device"><Smartphone size={22}/><div><strong>{connected && permission === 'granted' ? 'Это устройство подключено' : 'Это устройство пока молчит'}</strong><p>{demo ? 'В демо можно изучить настройки. Настоящие сигналы — в вашей личной книжке.' : !state.available ? 'Доставка уведомлений пока недоступна. Попробуй позже.' : permission === 'unsupported' ? 'На iPhone: Safari → «Поделиться» → «На экран “Домой”». Открой приложение с иконки. Нужна iOS 16.4 или новее.' : permission === 'denied' ? 'Разреши уведомления для «Договоримся» в настройках устройства, затем вернись сюда.' : `${state.deviceCount} подключённых устройств у твоего аккаунта. Разрешение выдаётся каждому отдельно.`}</p></div>{state.available && permission !== 'unsupported' && <button className="secondary-button" disabled={busy || !connected && permission === 'denied'} onClick={() => void (connected ? disconnect() : connect())}>{busy ? <Spinner/> : connected ? <BellOff size={15}/> : <Radio size={15}/>} {connected ? 'Отключить здесь' : 'Подключить'}</button>}</div>
      <Toggle title="Получать уведомления" description="Общий рубильник для всех твоих подключённых устройств. Ноль сигналов — тоже ответ." checked={prefs.enabled} disabled={busy} onChange={() => void save({ ...prefs, enabled: !prefs.enabled })}/>
      <div className={`notification-events ${prefs.enabled ? '' : 'disabled'}`}>{events.filter(event => !event.recipientOnly || role === 'recipient').map(({ kind, title, description }) => <Toggle key={kind} title={title} description={description} checked={prefs.events[kind]} disabled={busy || !prefs.enabled} onChange={() => void save({ ...prefs, events: { ...prefs.events, [kind]: !prefs.events[kind] } })}/>)}</div>
      <div className="notification-pause"><div><MoonStar size={20}/><div><strong>{paused ? 'Космос на паузе' : 'Режим «не трогайте котёнка»'}</strong><p>{paused ? `Тишина до ${new Date(prefs.mutedUntil!).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Пропущенное потом не посыплется.` : 'Никаких сигналов на время паузы. Даже если там пиздец какой важный аргумент.'}</p></div></div><label><span className="sr-only">Пауза уведомлений</span><select disabled={busy || !prefs.enabled} value={paused ? 'active' : '0'} onChange={e => void save({ ...prefs, mutedUntil: Number(e.target.value) ? Date.now() + Number(e.target.value) * 60 * 60_000 : null })}>{paused && <option value="active" disabled>Пауза включена</option>}<option value="0">Без паузы</option><option value="1">На 1 час</option><option value="8">На 8 часов</option><option value="24">На сутки</option><option value="168">На неделю</option></select></label></div>
      <Toggle title="Просить беззвучную доставку" description="Без звука и вибрации там, где браузер это поддерживает. На iPhone надёжнее выключить «Звуки» в Настройки → Уведомления → Договоримся или настроить «Фокусирование»." checked={prefs.silent} disabled={busy || !prefs.enabled} onChange={() => void save({ ...prefs, silent: !prefs.silent })}/>
      <div className="notification-foot"><p><VolumeX size={15}/>iOS управляет звуком сама. Пауза выше полностью останавливает новые отправки.</p><p>В уведомлении — только сигнал о событии. Текст отзыва, фото и баллы остаются внутри вашей книжки.</p>{connected && <button className="secondary-button" disabled={busy || !prefs.enabled || paused} onClick={async () => { setBusy(true); setError(''); setMessage(''); try { const subscription = await currentSubscription(); if (!subscription) throw new Error('Переподключи это устройство.'); await api('/api/notifications/test', json('POST', { endpoint: subscription.endpoint })); setMessage('Проверка в очереди. Если баннер не появился, проверь разрешение и «Фокусирование» на устройстве.'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><Send size={14}/>Проверить доставку</button>}</div>
    </>}{error && <p className="form-error" role="alert">{error}{!state && <button className="text-button" onClick={() => { setError(''); void load().catch(e => setError((e as Error).message)); }}>Попробовать снова</button>}</p>}{message && <p className="success-message" role="status">{message}</p>}
  </section>;
}
