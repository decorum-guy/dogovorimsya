import { ArrowLeft, Flame, Heart, Sparkles } from 'lucide-react';
import { ReviewCard } from './ReviewCard';
import { Brand } from './ui';
import { type Tone, toneNames } from '../lib/ratings';
import type { Review } from '../../shared/types';

const examples: { tone: Tone; rating: number; title: string; body: string; subtitle: string }[] = [
  { tone: 'gold', rating: 50, title: 'Ни одной претензии. Только любовь.', body: 'Завтрак в постель, кофе как надо и ты в моей футболке. Комиссия единогласно растаяла. Это честная пятёрка.', subtitle: 'Когда всё прекрасно. И даже лучше.' },
  { tone: 'rose', rating: 49, title: 'Идеально. Почти. Есть нюанс.', body: 'Свидание было прекрасным. Но твои «пять минут» оказались отдельным часовым поясом. За десятую ещё поторгуемся.', subtitle: 'Для спорных десятых и очень убедительных аргументов.' },
  { tone: 'paper', rating: 37, title: 'У пледа появился новый владелец.', body: 'По документам плед наш. По факту — твой. Мне достался уголок и аргумент: «зато я рядом». Заношу в протокол.', subtitle: 'Спокойный тон. Небольшие разногласия.' },
  { tone: 'ember', rating: 25, title: 'На кухне стало подозрительно жарко.', body: '«Я попробовала ложечку» — сказала ты над пустой тарелкой. Ужин был рассчитан на двоих. Переговоры накаляются.', subtitle: 'Уже искрит, но огнетушитель пока не нужен.' },
  { tone: 'inferno', rating: 10, title: 'Последняя. Картошка. Фри.', body: 'Ты посмотрела мне в глаза. Улыбнулась. И съела последнюю картошку. Дело передано в отдел особо вкусных преступлений.', subtitle: 'Один маленький домашний ад. Разные следы преступления.' },
];

export function RatingsGallery() {
  const selected = new URLSearchParams(location.search).get('tone');
  const groups = examples.filter(e => !selected || e.tone === selected);
  return <div className={`ratings-gallery ${selected ? 'single-tone' : ''}`}>
    <header className="gallery-header"><a href="/" aria-label="Вернуться в приложение"><Brand/></a><span className="gallery-label"><Heart size={14}/>Один стиль · живые детали</span></header>
    {groups.map(example => <section className={`gallery-section gallery-${example.tone}`} key={example.tone}>
      <div className="gallery-intro"><div><p className="eyebrow">НАСТРОЕНИЕ ЗАДАЁТ БАЛЛ. ДЕТАЛИ СКЛАДЫВАЮТСЯ САМИ.</p><h1><span>{(example.rating / 10).toFixed(1)}</span> {toneNames[example.tone]}<i>{example.tone === 'inferno' ? <Flame/> : <Sparkles/>}</i></h1><p>{example.subtitle}</p></div><span className="gallery-five">та же книжка.<br/><strong>каждый лист — свой.</strong></span></div>
      <div className="specimen-grid">{Array.from({ length: 5 }, (_, variant) => {
        const review: Review = { id: variant + 1, authorId: 1, recipientId: 2, rating: example.rating, title: example.title, body: example.body, eventDate: '2026-11-06', eventTime: '14:30', photoIds: [], createdAt: '', updatedAt: '', revision: 1, designVariant: variant, revisions: [], comments: [], reactions: [], favorite: false };
        return <div className="specimen-wrap" key={variant}><span className="specimen-label">ЛИСТ 0{variant + 1} · ДЕТАЛИ СЛОЖИЛИСЬ САМИ</span><ReviewCard review={review} specimen/></div>;
      })}<div className="gallery-end"><Heart size={28}/><p>Оцениваем моменты.<br/><em>Любим без оценок.</em></p><span>Скотч, сердечки и маленькие несовпадения.<br/>Каждый отзыв получает их автоматически.</span></div></div>
    </section>)}
    <footer className="gallery-footer"><span>Договоримся · ваша маленькая история</span><a href="/"><ArrowLeft size={14}/>В приложение</a></footer>
  </div>;
}
