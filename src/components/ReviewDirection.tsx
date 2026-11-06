import { ArrowRight } from 'lucide-react';
import type { Review, User } from '../../shared/types';
import { Avatar } from './ui';

export function ReviewDirection({ review, author, recipient, currentUserId }: {
  review: Pick<Review, 'authorId' | 'recipientId'>; author?: User; recipient?: User; currentUserId?: number;
}) {
  return <div className="review-direction" aria-label={'Автор: ' + (author?.name || 'твой человек') + '; получатель: ' + (recipient?.name || 'ждём регистрации')}>
    <span className="direction-person"><Avatar user={author} small/><span>{author?.name || 'Автор'}</span></span>
    <ArrowRight size={13} aria-hidden="true"/>
    <span className="direction-person"><Avatar user={recipient} small/><span>{recipient?.name || 'Твой человек'}</span></span>
    <small>{review.recipientId === currentUserId ? 'Тебе' : review.authorId === currentUserId ? 'От тебя' : ''}</small>
  </div>;
}
