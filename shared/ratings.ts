export type Tone = 'gold' | 'rose' | 'paper' | 'ember' | 'inferno';
export const getTone = (rating: number): Tone => rating === 50 ? 'gold' : rating >= 45 ? 'rose' : rating >= 35 ? 'paper' : rating >= 20 ? 'ember' : 'inferno';
export const toneNames: Record<Tone, string> = { gold: 'Сахарная передозировка', rose: 'Охуенно, но с нюансом', paper: 'Космос слегка помят', ember: 'Хьюстон, у нас характер', inferno: 'Пиздец, как полыхает' };
export const toneVoice: Record<Tone, { caption: string; hint: string; photos: string; stamp: string }> = {
  gold: { caption: 'заверните в обнимашки', hint: 'Слиплось сердечко? Опиши, от чего именно. Пятёрка тоже любит конкретику.', photos: 'Улики сахарной катастрофы', stamp: 'СЛИШКОМ СЛАДКО. ЕЩЁ.' },
  rose: { caption: 'одна десятая в розыске', hint: 'Почти космос. Где потерялась десятая? Версия «потому что» не считается.', photos: 'Красота с вещественными доказательствами', stamp: 'НЕЖНО, НО ДОКОПАЮСЬ' },
  paper: { caption: 'аргументы пристегнуть', hint: 'Не всё пошло по орбите. Расскажи, что было хорошо и что заело.', photos: 'Фотографии с места событий', stamp: 'КОСМОС С НЮАНСАМИ' },
  ember: { caption: 'бабочки с огнемётом', hint: 'Уже шкварчит. Претензии — к моменту, нежность — человеку.', photos: 'Материалы маленького ЧП', stamp: 'ХЬЮСТОН, ОБНИМИ' },
  inferno: { caption: 'пиздец локальный, любовь вечная', hint: 'Блядь, что произошло? Пиши честно о моменте. Любимый человек — не сумма баллов.', photos: 'Улики с места пиздеца', stamp: 'ПИЗДЕЦ, НО ЛЮБЛЮ' },
};
