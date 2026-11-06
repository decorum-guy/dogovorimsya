import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { BookHeart, Bookmark, UsersRound, KeyRound, Plus, LockKeyhole, Sparkles, Star, Flame, ArrowUpRight, Search, Heart, LogOut, WifiOff, RefreshCw, Menu, X, ShieldCheck, Infinity as InfinityIcon } from 'lucide-react';
import type { Bootstrap, Review, Role } from '../shared/types';
import { api, ApiError, json } from './lib/api';
import { chooseHomeMessage } from './lib/messages';
import { forgetDeviceSubscription } from './lib/push';
import { JournalSync } from './lib/journal-sync';
import { Avatar, Brand, Spinner } from './components/ui';
import { LoveLetter } from './components/Artwork';
import { ReviewCard } from './components/ReviewCard';
import { ReviewForm } from './components/ReviewForm';
import { ReviewDetail } from './components/ReviewDetail';
import { Profiles } from './components/Profiles';
import { RatingsGallery } from './components/RatingsGallery';
import { Login } from './components/Login';
import { Admin } from './components/Admin';
import { inDirection, type ReviewDirection } from '../shared/review-direction';
import { PullToRefresh } from './components/PullToRefresh';

type PushTarget = { reviewId: number; userId: number };
export type Save = (path: string, options: RequestInit) => Promise<void>;
export function App() {
  return location.pathname === '/design' ? <RatingsGallery/> : <SessionApp/>;
}
function SessionApp() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true), [demo, setDemo] = useState(false);
  const [error, setError] = useState(''), [warning, setWarning] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pushTarget, setPushTarget] = useState<PushTarget | null>(null);
  const [sync] = useState(() => new JournalSync(api, setData, setWarning));
  const loadingRequest = useRef(0);
  useLayoutEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); }, [data?.user.id]);
  async function load(initial = false) {
    const ticket = ++loadingRequest.current;
    setError('');
    try {
      const state = await api<{ demo: boolean }>('/api/status');
      if (ticket !== loadingRequest.current) return;
      setDemo(state.demo);
      try { await sync.refresh(); }
      catch (error) {
        if (ticket !== loadingRequest.current) return;
        if (error instanceof ApiError && error.status === 401) {
          if (initial && state.demo && !location.hash) {
            await api('/api/demo/login', json('POST', { role: 'reviewer' }));
            sync.reset(); await sync.refresh();
          }
        } else throw error;
      }
    } catch (error) { if (ticket === loadingRequest.current) setError((error as Error).message); }
    finally { if (ticket === loadingRequest.current) setLoading(false); }
  }
  useEffect(() => {
    void load(true);
    const online = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) void sync.refresh().catch(() => {});
    };
    window.addEventListener('online', online); window.addEventListener('offline', online);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', online); };
  }, []);
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== 'OPEN_REVIEW') return;
      const { reviewId, userId } = event.data;
      if (Number.isSafeInteger(reviewId) && reviewId > 0 && Number.isSafeInteger(userId) && userId > 0) setPushTarget({ reviewId, userId });
    };
    navigator.serviceWorker?.addEventListener('message', receive);
    return () => navigator.serviceWorker?.removeEventListener('message', receive);
  }, []);
  useEffect(() => {
    if (!data?.user.id) return;
    let lastRefresh = 0;
    const refreshOnReturn = (force = false) => {
      if (document.visibilityState !== 'visible' || !force && Date.now() - lastRefresh < 5000) return;
      lastRefresh = Date.now();
      void sync.refresh().catch(() => {});
    };
    const onReturn = () => refreshOnReturn();
    const onPush = (event: MessageEvent) => { if (event.data?.type === 'JOURNAL_CHANGED' || event.data?.type === 'OPEN_REVIEW') refreshOnReturn(true); };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    navigator.serviceWorker?.addEventListener('message', onPush);
    return () => { window.removeEventListener('focus', onReturn); document.removeEventListener('visibilitychange', onReturn); navigator.serviceWorker?.removeEventListener('message', onPush); };
  }, [data?.user.id]);
  async function logout() {
    await api('/api/logout', { method: 'POST' });
    loadingRequest.current++; sync.reset(); setData(null);
    await forgetDeviceSubscription();
  }
  if (loading) return <div className="loading-screen"><Brand/><Spinner/><p>Разворачиваем вашу карманную вселенную…</p></div>;
  if (error && !data) return <div className="loading-screen"><Brand/><WifiOff size={36}/><p role="alert">{error}</p><button className="primary-button" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={16}/>Попробовать ещё раз</button></div>;
  return <>
    {offline && <div className="offline-banner"><WifiOff size={15}/>Связь улетела в космос. Вернёмся, когда интернет очнётся.</div>}
    {warning && data && <div className="sync-warning" role="status"><span>{warning}</span><button className="text-button" onClick={() => { void sync.refresh().catch(error => setWarning((error as Error).message)); }}><RefreshCw size={15}/>Обновить</button></div>}
    {data ? <Journal key={data.user.id} data={data} pushTarget={pushTarget} onPushHandled={() => setPushTarget(null)} save={(path, options) => sync.save(path, options)} logout={logout} refresh={() => sync.refreshAfterWrites()} switchRole={async role => { await api('/api/demo/login', json('POST', { role })); setLoading(true); setData(null); sync.reset(); await load(); }}/> : <Login demo={demo} onLogin={async () => { sync.reset(); await load(); }}/>}
  </>;
}

function Journal({ data, save, logout, refresh, switchRole, pushTarget, onPushHandled }: { pushTarget: PushTarget | null; onPushHandled: () => void; data: Bootstrap; save: Save; logout: () => Promise<void>; refresh: () => Promise<void>; switchRole: (role: Role) => Promise<void> }) {
  const [page, setPage] = useState<'feed' | 'favorites' | 'profiles' | 'admin'>('feed');
  const [phrase, setPhrase] = useState(() => chooseHomeMessage(data.user.role, data.user.id));
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
  const [directions, setDirections] = useState<{ feed: ReviewDirection; favorites: ReviewDirection }>({ feed: 'received', favorites: 'all' });
  const directionPage = page === 'favorites' ? 'favorites' : 'feed';
  const direction = directions[directionPage];
  function selectDirection(value: ReviewDirection) { setDirections(previous => ({ ...previous, [directionPage]: value })); }
  const ownStatistics = data.statistics.participants.find(participant => participant.userId === data.user.id);
  const directionReviews = data.reviews.filter(review => inDirection(review, data.user.id, direction) && (page !== 'favorites' || review.favorite));
  const [editor, setEditor] = useState<Review | 'new' | null>(null), [selectedId, setSelectedId] = useState<number | null>(null);
  const [toast, setToast] = useState(''), [mobileMenu, setMobileMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshLock = useRef(false);
  async function refreshJournal() {
    if (refreshLock.current) return;
    refreshLock.current = true; setRefreshing(true);
    try { await refresh(); } catch (error) { setToast((error as Error).message); }
    finally { refreshLock.current = false; setRefreshing(false); }
  }
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (!query.has('review')) return;
    const id = Number(query.get('review')), recipientId = Number(query.get('for'));
    if (recipientId === data.user.id && data.reviews.some(review => review.id === id)) setSelectedId(id);
    else setToast(recipientId && recipientId !== data.user.id ? 'Этот сигнал был для другого профиля. Ты в своём аккаунте.' : 'Этот момент не найден. Обнови ленту.');
    query.delete('review'); query.delete('for');
    history.replaceState(null, '', location.pathname + (query.size ? `?${query}` : '') + location.hash);
  }, [data.user.id]);
  const [incomingReview, setIncomingReview] = useState<number | null>(null);
  useEffect(() => {
    if (!pushTarget) return;
    const { reviewId, userId } = pushTarget;
    if (userId !== data.user.id) setToast('Этот сигнал был для другого профиля. Ты в своём аккаунте.');
    else if (reviewId !== selectedId) {
      setIncomingReview(reviewId);
      if (editor || selectedId) setToast('Уведомление ждёт. Открою отзыв после закрытия текущего окна — твой текст на месте.');
    }
    onPushHandled();
  }, [pushTarget, data.user.id, editor, selectedId]);
  useEffect(() => {
    if (incomingReview && !editor && !selectedId && data.reviews.some(review => review.id === incomingReview)) { setSelectedId(incomingReview); setIncomingReview(null); }
  }, [incomingReview, editor, selectedId, data.reviews]);
  const selected = data.reviews.find(r => r.id === selectedId);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  const actionLocks = useRef(new Set<number>());
  const [busyReviews, setBusyReviews] = useState(new Set<number>());
  function act(id: number, operation: () => Promise<unknown>) {
    if (actionLocks.current.has(id)) return;
    actionLocks.current.add(id); setBusyReviews(new Set(actionLocks.current));
    void operation().catch(error => setToast((error as Error).message)).finally(() => { actionLocks.current.delete(id); setBusyReviews(new Set(actionLocks.current)); });
  }
  function navigate(next: typeof page) { if (next === 'feed' && page !== 'feed') setPhrase(chooseHomeMessage(data.user.role, data.user.id)); setPage(next); setMobileMenu(false); setSearch(''); setFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  const average = directionReviews.length ? (directionReviews.reduce((sum, r) => sum + r.rating, 0) / directionReviews.length / 10).toFixed(1) : '—';
  const list = directionReviews.filter(r => (filter === 'all' || filter === 'five' && r.rating === 50 || filter === 'fire' && r.rating < 35 || filter === 'edited' && r.revisions.length > 1) && `${r.title} ${r.body}`.toLowerCase().includes(search.toLowerCase()));
  const nav = [{ id: 'feed' as const, icon: BookHeart, label: 'Наша история' }, { id: 'favorites' as const, icon: Bookmark, label: 'Избранное' }, { id: 'profiles' as const, icon: UsersRound, label: 'Мы вдвоём' }, ...(data.user.isAdmin ? [{ id: 'admin' as const, icon: KeyRound, label: 'Доступ' }] : [])];
  return <div className="app-layout">
    <aside className={`sidebar ${mobileMenu ? 'mobile-open' : ''}`}><a className="brand-link" href="/" onClick={event => { event.preventDefault(); navigate('feed'); }}><Brand/></a><button className="icon-button menu-close" aria-label="Закрыть меню" onClick={() => setMobileMenu(false)}><X/></button><div className="sidebar-rule"/><span className="nav-caption">СОВЕРШЕННО МЕЖДУ НАМИ</span><nav>{nav.map(({ id, icon: Icon, label }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={19}/>{label}{id === 'feed' && <span>{data.reviews.length}</span>}</button>)}</nav><div className="sidebar-note"><span>маленькая книжка</span><Heart size={24}/><em>охуенных нас</em><svg viewBox="0 0 140 14" aria-hidden="true"><path d="M4 8Q70-3 136 6M13 12Q70 3 121 9" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg></div><div className="sidebar-bottom"><div className="private-note"><InfinityIcon size={22}/><p>Создано для двоих.<br/><span>Всем остальным — в другую галактику.</span></p></div>{data.demo && <a href="/design" className="demo-badge">Демо · вымышленные записи<ArrowUpRight size={12}/></a>}<button className="sidebar-user" onClick={() => navigate('profiles')}><Avatar user={data.user}/><span><strong>{data.user.name}</strong><small>Твой профиль</small></span><ArrowUpRight size={15}/></button></div></aside>
    {mobileMenu && <button className="menu-backdrop" aria-label="Закрыть меню" onClick={() => setMobileMenu(false)}/>}
    <main className="main-content"><PullToRefresh enabled={(page === 'feed' || page === 'favorites') && !editor && !selectedId && !mobileMenu} refreshing={refreshing} onRefresh={refreshJournal}><header className="topbar"><div className="mobile-top"><Brand compact/></div><span className="today">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span><div className="topbar-right"><span className="privacy"><LockKeyhole size={13}/>Только вы вдвоём</span><div className="avatar-pair">{data.users.map(user => <Avatar key={user.id} user={user}/>)}</div><button className="icon-button refresh-button" title="Обновить ленту" aria-label="Обновить ленту" disabled={refreshing} onClick={() => { void refreshJournal(); }}><RefreshCw size={15} className={refreshing ? 'spin' : ''}/></button><button className="icon-button mobile-menu-button" aria-label="Открыть меню" onClick={() => setMobileMenu(true)}><Menu size={22}/></button></div></header>
      {page === 'profiles' ? <Profiles data={data} save={save} logout={logout} switchRole={switchRole}/> : page === 'admin' ? <Admin data={data}/> : <>
        {page === 'feed' ? <><section className="hero"><div className="hero-copy"><p className="eyebrow"><span/>ЦЕНТР УПРАВЛЕНИЯ ВАШИМ ХАОСОМ</p><h1>{phrase}</h1><p className="hero-description">{data.user.role === 'reviewer' ? <>От «моя булочка» до «ну какого хрена».<br/>Ваш охуенный космос — по-честному.</> : <>Тебе — все карманные галактики.<br/>И право сказать: «Да вы охуели, ваша честь».</>}</p><div className="hero-footnote"><Heart size={12}/><span>Баллы — моментам. Тебе — всё моё дурацкое сердечко.</span></div></div><LoveLetter/></section><section className="stats" aria-label="Ваша история в цифрах"><div className="stat"><span className="stat-icon lilac"><BookHeart size={20}/></span><div><span>{direction === 'received' ? 'Оценок тебе' : direction === 'sent' ? 'Отзывов от тебя' : 'Моментов вдвоём'}</span><strong>{directionReviews.length}<small>улики вашего хаоса</small></strong></div></div><div className="stat"><span className="stat-icon gold"><Star size={20}/></span><div><span>{direction === 'all' ? 'Тебе / от тебя' : direction === 'sent' ? 'Твоя средняя оценка' : 'Твой средний балл'}</span><strong>{direction === 'all' ? (ownStatistics?.receivedCount || 0) + ' / ' + (ownStatistics?.sentCount || 0) : average}<small>{direction === 'all' ? 'два направления нежности' : 'любовь — вне рейтинга'}</small></strong></div></div><div className="stat"><span className="stat-icon pink"><Sparkles size={20}/></span><div><span>Пятёрок в этой ленте</span><strong>{directionReviews.filter(r => r.rating === 50).length}<small>сироп льётся рекой</small></strong></div></div></section></> : <section className="favorites-hero"><p className="eyebrow">ЛИЧНЫЙ ЗАПАС МАЛЕНЬКИХ ВСЕЛЕННЫХ</p><h1>Заначка для сердечка.</h1><p>Самое своё. Даже если это был полный пиздец с хорошим финалом.</p><Bookmark size={60}/></section>}
        <section className="journal-section"><div className="section-heading"><div><h2>{page === 'favorites' ? 'Избранное' : 'Наше личное дело'}<span>{directionReviews.length}</span></h2><p>Теперь звёздочки летают в обе стороны. Охренеть, договорились ♡</p></div><button className="primary-button new-review" onClick={() => setEditor('new')}><Plus size={18}/><span>Новая оценка</span></button></div>
          <div className="direction-tabs" role="group" aria-label="Направление отзывов">{([{ value: 'received', label: 'Тебе' }, { value: 'sent', label: 'От тебя' }, { value: 'all', label: 'Всё' }] as const).map(item => <button key={item.value} className={direction === item.value ? 'active' : ''} aria-pressed={direction === item.value} onClick={() => selectDirection(item.value)}>{item.label}<span>{data.reviews.filter(review => inDirection(review, data.user.id, item.value) && (page !== 'favorites' || review.favorite)).length}</span></button>)}</div>
          <div className="feed-toolbar"><div className="filters" aria-label="Фильтр отзывов">{[{ value: 'all', label: 'Все моменты' }, { value: 'five', label: 'Сахар', icon: Star }, { value: 'fire', label: 'Пожар', icon: Flame }, { value: 'edited', label: 'Пересмотрены' }].map(({ value, label, icon: Icon }) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{Icon && <Icon size={13}/>}<span>{label}</span></button>)}</div><label className="search"><Search size={16}/><input aria-label="Поиск по отзывам" placeholder="Найти улики" value={search} onChange={event => setSearch(event.target.value)}/></label></div>
          {list.length ? <div className="review-grid">{list.map(review => <ReviewCard key={review.id} review={review} busy={busyReviews.has(review.id)} currentUserId={data.user.id} author={data.users.find(u => u.id === review.authorId)} recipient={data.users.find(u => u.id === review.recipientId)} onOpen={() => setSelectedId(review.id)} onFavorite={() => act(review.id, () => save(`/api/reviews/${review.id}/favorite`, json('PUT', { favorite: !review.favorite })))} onReact={emoji => act(review.id, () => save(`/api/reviews/${review.id}/reactions`, json('PUT', { emoji, active: !review.reactions.some(reaction => reaction.userId === data.user.id && reaction.emoji === emoji) })))}/>)}</div> : <div className="empty-state"><BookHeart size={42}/><h3>{search || filter !== 'all' ? 'Улики ушли в астрал.' : page === 'favorites' ? 'Сердечко пока без заначки.' : direction === 'received' ? 'Твоя очередь получать звёздочки.' : 'Космос пока без протокола.'}</h3><p>{search || filter !== 'all' ? 'Попробуй другой запрос или фильтр.' : page === 'favorites' ? 'Звёздочка у отзыва припрячет его здесь. Проверь и другие направления.' : direction === 'received' ? 'Тут будут отзывы твоего человека о тебе. А свою нежность и претензии уже можно отправлять навстречу.' : 'Начни с «обожаю». Или с «ну блядь». Главное — с настоящего момента.'}</p>{!search && filter === 'all' && page === 'feed' && <div className="empty-actions">{direction === 'received' && <button className="secondary-button" onClick={() => selectDirection('sent')}>Посмотреть свои отзывы</button>}<button className="primary-button" onClick={() => setEditor('new')}><Plus size={17}/>Новая оценка</button></div>}</div>}
        </section><footer className="page-footer"><Heart size={13}/><span>Пиздец какие разные. До невозможности свои.</span><span>Договоримся.</span></footer></>}
    </PullToRefresh></main>
    <nav className="mobile-nav" aria-label="Основная навигация">{nav.map(({ id, icon: Icon, label }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={21}/><span>{label}</span></button>)}</nav>
    {editor && <ReviewForm review={editor === 'new' ? undefined : editor} recipient={data.users.find(user => editor === 'new' ? user.id !== data.user.id : user.id === editor.recipientId)} save={save} onClose={() => setEditor(null)} onSaved={() => { if (editor === 'new') { navigate('feed'); setDirections(previous => ({ ...previous, feed: 'sent' })); } setEditor(null); setToast(editor === 'new' ? 'Ваш прекрасный беспредел задокументирован ♡' : 'Улики обновлены. История всё помнит ♡'); }}/>}
    {selected && !editor && <ReviewDetail review={selected} data={data} save={save} refresh={refresh} onClose={() => setSelectedId(null)} onEdit={() => setEditor(selected)}/>}
    {toast && <div className="toast" role="status"><Heart size={16}/>{toast}<button aria-label="Закрыть уведомление" onClick={() => setToast('')}><X size={16}/></button></div>}
  </div>;
}
