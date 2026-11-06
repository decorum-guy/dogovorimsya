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
    { label: 'Избранное автора', value: stats.favorites.reviewer, hint: author?.name || 'Автор', icon: Star, color: 'gold' },
    { label: 'Её избранное', value: stats.favorites.recipient, hint: recipient?.name || 'Ещё ждём её', icon: Star, color: 'rose' },
    { label: 'Совпали в избранном', value: stats.favorites.mutual, hint: 'два сердечка сказали «моё»', icon: Stars, color: 'rose' },
    { label: 'Сахарная передозировка', value: stats.perfectCount, hint: 'слипнуться и не расклеиваться', icon: Sparkles, color: 'gold' },
    { label: 'Аргументов в комментариях', value: stats.commentCount, hint: 'дипломатия или словесный файт', icon: MessageCircle, color: 'sage' },
    { label: 'Фото в отзывах', value: stats.photoCount, hint: 'компромат с родными глазами', icon: Camera, color: 'plum' },
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

    <div className="couple-metrics">{tiles.map(({ label, value, hint, icon: Icon, color }) => <article className={`couple-metric metric-${color}`} key={label}>
      <div className="metric-top"><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><p>{hint}</p>
    </article>)}</div>

    <div className="statistics-bottom">
      <section className="mood-statistics" aria-label="Оценки ваших моментов"><header><div><h3>Настроение вашей книжки</h3><p>От сахарной комы до «тушите нахрен». Любовь — вне шкалы.</p></div><div className="average-badge"><span>Средний балл</span><strong>{stats.averageRating === null ? '—' : stats.averageRating.toFixed(1)}<small>/ 5</small></strong></div></header>
        <div className={`mood-bar ${stats.reviewCount ? '' : 'empty'}`} aria-hidden="true">{moods.filter(({ tone }) => stats.ratingDistribution[tone] > 0).map(({ tone }) => <span key={tone} className={`mood-${tone}`} style={{ flex: stats.ratingDistribution[tone] }}/>)}</div>
        <div className="mood-legend">{moods.map(({ tone, label }) => <div key={tone}><span className={`mood-dot mood-${tone}`}/><span>{label}</span><strong>{stats.ratingDistribution[tone]}</strong></div>)}</div>
      </section>
      <section className="emotion-statistics" aria-label="Ваши реакции"><header><h3>Невербальные аргументы</h3><span>{reactions} {plural(reactions, ['реакция', 'реакции', 'реакций'])}</span></header><div className="emotion-totals">{emotions.map(({ emoji, label }) => <div key={emoji}><span aria-hidden="true">{emoji}</span><strong>{stats.reactions.find(item => item.emoji === emoji)?.count || 0}</strong><small>{label}</small></div>)}</div><p>Слова закончились. Осталось «аааа» и сердечко.</p></section>
    </div>
    <p className="statistics-footnote"><Heart size={12}/>Считать можно до бесконечности. Целовать — тоже.</p>
  </section>;
}
