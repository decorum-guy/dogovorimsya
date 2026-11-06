import type { ReviewComment } from './types.js';

export function commentVersion(comments: Pick<ReviewComment, 'id' | 'revision'>[]): string {
  return [comments.length, comments.reduce((max, comment) => Math.max(max, comment.id), 0), comments.reduce((sum, comment) => sum + comment.revision, 0)].join(':');
}
