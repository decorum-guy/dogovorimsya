export type Tone = 'gold' | 'rose' | 'paper' | 'ember' | 'inferno';
export const getTone = (rating: number): Tone => rating === 50 ? 'gold' : rating >= 45 ? 'rose' : rating >= 35 ? 'paper' : rating >= 20 ? 'ember' : 'inferno';
export const toneNames: Record<Tone, string> = { gold: 'Безоговорочно прекрасно', rose: 'Есть маленький нюанс', paper: 'Есть что обсудить', ember: 'Переговоры накаляются', inferno: 'Это уже пожар' };
