import type { Review } from './types.js';

export type ReviewDirection = 'received' | 'sent' | 'all';
export function inDirection(review: Pick<Review, 'authorId' | 'recipientId'>, userId: number, direction: ReviewDirection) {
  return direction === 'all' || (direction === 'received' ? review.recipientId === userId : review.authorId === userId);
}
