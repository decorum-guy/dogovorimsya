import { useEffect, useState } from 'react';
import { BookHeart, CalendarHeart, Camera, Heart, History, MessageCircle, Sparkles, Star, Stars } from 'lucide-react';
import type { Bootstrap } from '../../shared/types';
import type { Tone } from '../../shared/ratings';
import { daysInJournal, journalTimeZone, plural } from '../../shared/journal-days';

const moods: { tone: Tone; label: string }[] = [
  { tone: 'gold', label: 'Сахарная передозировка' },
  { tone: 'rose', label: 'Почти идеально' },
  { tone: 'paper', label: 'С нюансами' },
  { tone: 'ember', label: 'С огоньком' },
  { tone: 'inferno', label: 'Пиздец, как полыхает' },
];
const emotions = [
  { emoji: '❤️', label: 'Сердечки' }, { emoji: '🔥', label: 'Огонь' },
  { emoji: '😂', label: 'Орнули' }, { emoji: '🥺', label: 'Умиление' },
];

export function CoupleStatistics({ data }: { data: Bootstrap }) {
  const stats = data.statistics;
  const [selectedUserId, setSelectedUserId] = useState(data.user.id);
  const selectedStats = stats.participants.find(item => item.userId === selectedUserId) || {
    userId: data.user.id, receivedCount: 0, sentCount: 0, averageRating: null, perfectCount: 0,
    ratingDistribution: { gold: 0, rose: 0, paper: 0, ember: 0, inferno: 0 },
  };
  const selectedUser = data.users.find(user => user.id === selectedStats.userId) || data.user;
  const author = data.users.find(user => user.role === 'reviewer');
  const recipient = data.users.find(user => user.role === 'recipient');
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const interval = window.setInterval(tick, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  const days = daysInJournal(stats.startedAt, now);
  const started = stats.startedAt ? new Date(stats.startedAt).toLocaleDateString('ru-RU', { timeZone: journalTimeZone, day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const tiles = [
    { label: 'Моментов в книжке', value: stats.reviewCount, hint: 'милоту и пиздец бережно учли', icon: BookHeart, color: 'plum' },
    { label: author?.name ? 'Избранное: ' + author.name : 'Первое сердечко', value: stats.favorites.reviewer, hint: author?.name || 'Автор', icon: Star, color: 'gold' },
    { label: recipient?.name ? 'Избранное: ' + recipient.name : 'Второе сердечко', value: stats.favorites.recipient, hint: recipient?.name || 'Ещё ждём её', icon: Star, color: 'rose' },
    { label: 'Совпали в избранном', value: stats.favorites.mutual, hint: 'два сердечка сказали «моё»', icon: Stars, color: 'rose' },
    { label: 'Пятёрок на двоих', value: stats.perfectCount, hint: 'слипнуться и не расклеиваться', icon: Sparkles, color: 'gold' },
    { label: 'Аргументов в комментариях', value: stats.commentCount, hint: 'дипломатия или словесный файт', icon: MessageCircle, color: 'sage' },
    { label: 'Фото в вашей книжке', value: stats.photoCount, hint: 'моменты и улики из обсуждений', icon: Camera, color: 'plum' },
    { label: 'Оценок пересмотрено', value: stats.revisedRatingCount, hint: stats.raisedRatingCount ? `${stats.raisedRatingCount} ${plural(stats.raisedRatingCount, ['стала выше', 'стали выше', 'стали выше'])}` : 'история помнит все десятые', icon: History, color: 'sage' },
  ];
  const reactions = stats.reactions.reduce((sum, item) => sum + item.count, 0);

  return <section className="couple-statistics" aria-labelledby="couple-statistics-title">
    <div className="statistics-heading"><div><p className="eyebrow">БУХГАЛТЕРИЯ СЕРДЕЧЕК И ХАОСА</p><h2 id="couple-statistics-title">Сколько нас накопилось.</h2></div><Heart size={21}/></div>
    <div className={`journal-days ${days === null ? 'waiting' : ''}`}>
      <span className="days-calendar" aria-hidden="true"><CalendarHeart size={27}/><span>♡</span></span>
      <div className="days-counter">{days !== null ? <><strong>{days}</strong><div><h3>{plural(days, ['день', 'дня', 'дней'])} тут вдвоём</h3><p>С {started} · день регистрации — первый</p></div></> : <div><h3>{recipient ? 'Каждый день — новая история.' : 'Ждём вторую подпись.'}</h3><p>{recipient ? 'Дата регистрации не сохранилась. Остальные моменты уже считаются.' : 'Отсчёт начнётся в день, когда она зарегистрируется.'}</p></div>}</div>
      <span className="days-doodle" aria-hidden="true">время идёт.<br/><em>котики влюбляются.</em><Heart size={23}/></span>
    </div>

    <div className="participant-statistics" aria-label="Оценки каждого участника">{stats.participants.map(participant => {
      const user = data.users.find(user => user.id === participant.userId);
      return <article key={participant.userId} className={'participant-score ' + (user?.role || '')}>
        <div className="participant-score-heading"><span>{user?.name || 'Твой человек'}</span><small>{participant.userId === data.user.id ? 'это ты ♡' : 'твой космос ♡'}</small></div>
        <p>Средний балл полученных оценок</p><strong>{participant.averageRating === null ? '—' : participant.averageRating.toFixed(1)}<small> / 5</small></strong>
        <div className="participant-totals"><span><b>{participant.receivedCount}</b> получено</span><span><b>{participant.sentCount}</b> написано</span><span><b>{participant.perfectCount}</b> пятёрок</span></div>
        {!participant.receivedCount && <small className="participant-waiting">Звёздочки ещё в пути. Любовь уже тут.</small>}
      </article>;
    })}</div>

    <div className="couple-metrics">{tiles.map(({ label, value, hint, icon: Icon, color }) => <article className={`couple-metric metric-${color}`} key={label}>
      <div className="metric-top"><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><p>{hint}</p>
    </article>)}</div>

    <div className="statistics-bottom">
      <section className="mood-statistics" aria-label="Оценки ваших моментов"><header><div><h3>Полученные оценки · {selectedUser.name}</h3><p>От сахарной комы до «тушите нахрен». Любовь — вне шкалы.</p></div><div className="average-badge"><span>Средний балл</span><strong>{selectedStats.averageRating === null ? '—' : selectedStats.averageRating.toFixed(1)}<small>/ 5</small></strong></div></header>
        <div className="statistics-people" role="group" aria-label="Чьи оценки показать">{data.users.map(user => <button key={user.id} aria-pressed={selectedStats.userId === user.id} className={selectedStats.userId === user.id ? 'active' : ''} onClick={() => setSelectedUserId(user.id)}>{user.name}</button>)}</div>
        <div className={`mood-bar ${selectedStats.receivedCount ? '' : 'empty'}`} aria-hidden="true">{moods.filter(({ tone }) => selectedStats.ratingDistribution[tone] > 0).map(({ tone }) => <span key={tone} className={`mood-${tone}`} style={{ flex: selectedStats.ratingDistribution[tone] }}/>)}</div>
        <div className="mood-legend">{moods.map(({ tone, label }) => <div key={tone}><span className={`mood-dot mood-${tone}`}/><span>{label}</span><strong>{selectedStats.ratingDistribution[tone]}</strong></div>)}</div>
      </section>
      <section className="emotion-statistics" aria-label="Ваши реакции"><header><h3>Невербальные аргументы</h3><span>{reactions} {plural(reactions, ['реакция', 'реакции', 'реакций'])}</span></header><div className="emotion-totals">{emotions.map(({ emoji, label }) => <div key={emoji}><span aria-hidden="true">{emoji}</span><strong>{stats.reactions.find(item => item.emoji === emoji)?.count || 0}</strong><small>{label}</small></div>)}</div><p>Слова закончились. Осталось «аааа» и сердечко.</p></section>
    </div>
    <p className="statistics-footnote"><Heart size={12}/>Считать можно до бесконечности. Целовать — тоже.</p>
  </section>;
}
