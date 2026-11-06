import { useEffect, useState, type FormEvent } from 'react';
import { BookHeart, Bookmark, UsersRound, KeyRound, Plus, LockKeyhole, Sparkles, Star, Flame, ArrowUpRight, Search, Heart, LogOut, WifiOff, RefreshCw, Menu, X, ShieldCheck, Infinity as InfinityIcon } from 'lucide-react';
import type { Bootstrap, Review, Role } from '../shared/types';
import { api, ApiError, json } from './lib/api';
import { chooseHomeMessage } from './lib/messages';
import { Avatar, Brand, Spinner } from './components/ui';
import { LoveLetter } from './components/Artwork';
import { ReviewCard } from './components/ReviewCard';
import { ReviewForm } from './components/ReviewForm';
import { ReviewDetail } from './components/ReviewDetail';
import { Profiles } from './components/Profiles';
import { RatingsGallery } from './components/RatingsGallery';
import { Login } from './components/Login';
import { Admin } from './components/Admin';

export type Save = (path: string, options: RequestInit) => Promise<void>;
export function App() {
  return location.pathname === '/design' ? <RatingsGallery/> : <SessionApp/>;
}
function SessionApp() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(!navigator.onLine);
  async function load(initial = false) {
    setError('');
    try {
      const state = await api<{ demo: boolean }>('/api/status'); setDemo(state.demo);
      try { setData(await api<Bootstrap>('/api/bootstrap')); }
      catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          if (initial && state.demo && !location.hash) { await api('/api/demo/login', json('POST', { role: 'reviewer' })); setData(await api<Bootstrap>('/api/bootstrap')); }
          else setData(null);
        } else throw error;
      }
    } catch (error) { setError((error as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void load(true);
    const online = () => setOffline(!navigator.onLine);
    window.addEventListener('online', online); window.addEventListener('offline', online);
    return () => { window.removeEventListener('online', online); window.removeEventListener('offline', online); };
  }, []);
  const save: Save = async (path, options) => {
    try { await api(path, options); setData(await api<Bootstrap>('/api/bootstrap')); }
    catch (error) { if (error instanceof ApiError && error.status === 401) setData(null); throw error; }
  };
  async function logout() { await api('/api/logout', { method: 'POST' }); setData(null); }
  if (loading) return <div className="loading-screen"><Brand/><Spinner/><p>Открываем вашу историю…</p></div>;
  if (error && !data) return <div className="loading-screen"><Brand/><WifiOff size={36}/><p role="alert">{error}</p><button className="primary-button" onClick={() => { setLoading(true); void load(); }}><RefreshCw size={16}/>Попробовать ещё раз</button></div>;
  return <>{offline && <div className="offline-banner"><WifiOff size={15}/>Нет связи. Вернёмся к вашей истории, когда появится интернет.</div>}{data ? <Journal key={data.user.id} data={data} save={save} logout={logout} refresh={() => load()} switchRole={async role => { await api('/api/demo/login', json('POST', { role })); await load(); }}/> : <Login demo={demo} onLogin={() => load()}/>}</>;
}

function Journal({ data, save, logout, refresh, switchRole }: { data: Bootstrap; save: Save; logout: () => Promise<void>; refresh: () => Promise<void>; switchRole: (role: Role) => Promise<void> }) {
  const [page, setPage] = useState<'feed' | 'favorites' | 'profiles' | 'admin'>('feed');
  const [phrase, setPhrase] = useState(() => chooseHomeMessage(data.user.role, data.user.id));
  const [filter, setFilter] = useState('all'), [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Review | 'new' | null>(null), [selectedId, setSelectedId] = useState<number | null>(null);
  const [toast, setToast] = useState(''), [mobileMenu, setMobileMenu] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const selected = data.reviews.find(r => r.id === selectedId);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); }, [toast]);
  const act = (promise: Promise<unknown>) => { promise.catch(error => setToast((error as Error).message)); };
  function navigate(next: typeof page) { if (next === 'feed' && page !== 'feed') setPhrase(chooseHomeMessage(data.user.role, data.user.id)); setPage(next); setMobileMenu(false); setSearch(''); setFilter('all'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  const average = data.reviews.length ? (data.reviews.reduce((sum, r) => sum + r.rating, 0) / data.reviews.length / 10).toFixed(1) : '—';
  const list = data.reviews.filter(r => (page !== 'favorites' || r.favorite) && (filter === 'all' || filter === 'five' && r.rating === 50 || filter === 'fire' && r.rating < 35 || filter === 'edited' && r.revisions.length > 1) && `${r.title} ${r.body}`.toLowerCase().includes(search.toLowerCase()));
  const nav = [{ id: 'feed' as const, icon: BookHeart, label: 'Наша история' }, { id: 'favorites' as const, icon: Bookmark, label: 'Избранное' }, { id: 'profiles' as const, icon: UsersRound, label: 'Мы вдвоём' }, ...(data.user.role === 'reviewer' ? [{ id: 'admin' as const, icon: KeyRound, label: 'Доступ' }] : [])];
  return <div className="app-layout">
    <aside className={`sidebar ${mobileMenu ? 'mobile-open' : ''}`}><a className="brand-link" href="/" onClick={event => { event.preventDefault(); navigate('feed'); }}><Brand/></a><button className="icon-button menu-close" aria-label="Закрыть меню" onClick={() => setMobileMenu(false)}><X/></button><div className="sidebar-rule"/><span className="nav-caption">ВАШЕ ЛИЧНОЕ ДЕЛО</span><nav>{nav.map(({ id, icon: Icon, label }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={19}/>{label}{id === 'feed' && <span>{data.reviews.length}</span>}</button>)}</nav><div className="sidebar-note"><span>маленькая книжка</span><Heart size={24}/><em>больших чувств</em><svg viewBox="0 0 140 14" aria-hidden="true"><path d="M4 8Q70-3 136 6M13 12Q70 3 121 9" fill="none" stroke="currentColor" strokeWidth="1.6"/></svg></div><div className="sidebar-bottom"><div className="private-note"><InfinityIcon size={22}/><p>Создано для двоих.<br/><span>Всё остальное обсудим.</span></p></div>{data.demo && <a href="/design" className="demo-badge">Демо · вымышленные записи<ArrowUpRight size={12}/></a>}<button className="sidebar-user" onClick={() => navigate('profiles')}><Avatar user={data.user}/><span><strong>{data.user.name}</strong><small>{data.user.role === 'reviewer' ? 'Автор оценок' : 'Главная героиня'}</small></span><ArrowUpRight size={15}/></button></div></aside>
    {mobileMenu && <button className="menu-backdrop" aria-label="Закрыть меню" onClick={() => setMobileMenu(false)}/>}
    <main className="main-content"><header className="topbar"><div className="mobile-top"><Brand compact/></div><span className="today">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span><div className="topbar-right"><span className="privacy"><LockKeyhole size={13}/>Только вы вдвоём</span><div className="avatar-pair">{data.users.map(user => <Avatar key={user.id} user={user}/>)}</div><button className="icon-button refresh-button" title="Обновить ленту" aria-label="Обновить ленту" disabled={refreshing} onClick={async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }}><RefreshCw size={15} className={refreshing ? 'spin' : ''}/></button><button className="icon-button mobile-menu-button" aria-label="Открыть меню" onClick={() => setMobileMenu(true)}><Menu size={22}/></button></div></header>
      {page === 'profiles' ? <Profiles data={data} save={save} logout={logout} switchRole={switchRole}/> : page === 'admin' ? <Admin data={data}/> : <>
        {page === 'feed' ? <><section className="hero"><div className="hero-copy"><p className="eyebrow"><span/>ПРОТОКОЛ НЕЖНОСТИ ОТКРЫТ</p><h1>{phrase}</h1><p className="hero-description">Честные оценки. Нежные претензии.<br/>Ваша история — со всеми звёздочками.</p><div className="hero-footnote"><Heart size={12}/><span>Оцениваем моменты. Любим без оценок.</span></div></div><LoveLetter/></section><section className="stats" aria-label="Ваша история в цифрах"><div className="stat"><span className="stat-icon lilac"><BookHeart size={20}/></span><div><span>Моментов в истории</span><strong>{data.reviews.length}<small>и это только начало</small></strong></div></div><div className="stat"><span className="stat-icon gold"><Star size={20}/></span><div><span>Средняя оценка</span><strong>{average}<small>любовь — вне рейтинга</small></strong></div></div><div className="stat"><span className="stat-icon pink"><Sparkles size={20}/></span><div><span>Безоговорочных пятёрок</span><strong>{data.reviews.filter(r => r.rating === 50).length}<small>аргументы не требуются</small></strong></div></div></section></> : <section className="favorites-hero"><p className="eyebrow">СОХРАНЕНО БЛИЖЕ К СЕРДЦУ</p><h1>Особенные моменты.</h1><p>Твои закладки. Чтобы возвращаться и улыбаться.</p><Bookmark size={60}/></section>}
        <section className="journal-section"><div className="section-heading"><div><h2>{page === 'favorites' ? 'Избранное' : 'Книга отзывов'}<span>{page === 'favorites' ? data.reviews.filter(r => r.favorite).length : data.reviews.length}</span></h2><p>{data.user.role === 'reviewer' ? 'Здесь у каждого момента своя оценка.' : 'Твоя версия событий тоже имеет значение.'}</p></div>{data.user.role === 'reviewer' && <button className="primary-button new-review" onClick={() => setEditor('new')}><Plus size={18}/><span>Новая оценка</span></button>}</div>
          <div className="feed-toolbar"><div className="filters" aria-label="Фильтр отзывов">{[{ value: 'all', label: 'Все моменты' }, { value: 'five', label: 'На все пять', icon: Star }, { value: 'fire', label: 'С огоньком', icon: Flame }, { value: 'edited', label: 'Пересмотрены' }].map(({ value, label, icon: Icon }) => <button key={value} className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{Icon && <Icon size={13}/>}<span>{label}</span></button>)}</div><label className="search"><Search size={16}/><input aria-label="Поиск по отзывам" placeholder="Найти момент" value={search} onChange={event => setSearch(event.target.value)}/></label></div>
          {list.length ? <div className="review-grid">{list.map(review => <ReviewCard key={review.id} review={review} currentUserId={data.user.id} author={data.users.find(u => u.id === review.authorId)} onOpen={() => setSelectedId(review.id)} onFavorite={() => act(save(`/api/reviews/${review.id}/favorite`, json('PUT', { favorite: !review.favorite })))} onReact={emoji => act(save(`/api/reviews/${review.id}/reactions`, json('PUT', { emoji })))}/>)}</div> : <div className="empty-state"><BookHeart size={42}/><h3>{search || filter !== 'all' ? 'Этот момент ещё не нашёлся.' : page === 'favorites' ? 'Для самого любимого.' : 'У каждой истории есть первая страница.'}</h3><p>{search || filter !== 'all' ? 'Попробуй другой запрос или фильтр.' : page === 'favorites' ? 'Нажми на закладку у отзыва — он останется здесь.' : data.user.role === 'reviewer' ? 'Вспомни маленький момент и поставь ему честную оценку.' : 'Первый отзыв скоро появится здесь.'}</p>{!search && filter === 'all' && page === 'feed' && data.user.role === 'reviewer' && <button className="primary-button" onClick={() => setEditor('new')}><Plus size={17}/>Первая оценка</button>}</div>}
        </section><footer className="page-footer"><Heart size={13}/><span>Не всё в любви измеряется. Но кое-что можно обсудить.</span><span>Договоримся.</span></footer></>}
    </main>
    <nav className="mobile-nav" aria-label="Основная навигация">{nav.map(({ id, icon: Icon, label }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => navigate(id)}><Icon size={21}/><span>{label}</span></button>)}</nav>
    {editor && <ReviewForm review={editor === 'new' ? undefined : editor} save={save} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setToast(editor === 'new' ? 'Новый момент — в вашей истории ♡' : 'Сохранено. История всё помнит ♡'); }}/>}
    {selected && !editor && <ReviewDetail review={selected} data={data} save={save} onClose={() => setSelectedId(null)} onEdit={() => setEditor(selected)}/>}
    {toast && <div className="toast" role="status"><Heart size={16}/>{toast}<button aria-label="Закрыть уведомление" onClick={() => setToast('')}><X size={16}/></button></div>}
  </div>;
}
