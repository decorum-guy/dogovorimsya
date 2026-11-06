import type { Tone } from './ratings.js';

export type Role = 'reviewer' | 'recipient';
export interface User {
  id: number;
  name: string;
  role: Role;
  isAdmin: boolean;
  avatarId: string | null;
}
export interface Revision {
  id: number;
  rating: number;
  title: string;
  body: string;
  eventDate: string;
  eventTime: string | null;
  photoIds: string[];
  note: string;
  createdAt: string;
  userId: number;
}
export interface CommentPhoto {
  id: string;
  caption: string;
}
export interface ReviewComment {
  id: number;
  userId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  photos: CommentPhoto[];
}
export interface Review {
  id: number;
  authorId: number;
  recipientId: number | null;
  rating: number;
  title: string;
  body: string;
  eventDate: string;
  eventTime: string | null;
  photoIds: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
  designVariant: number;
  revisions: Revision[];
  comments: ReviewComment[];
  reactions: { userId: number; emoji: string }[];
  favorite: boolean;
}
export interface Bootstrap {
  user: User;
  users: User[];
  reviews: Review[];
  demo: boolean;
  statistics: CoupleStatistics;
}
export interface CoupleStatistics {
  startedAt: string | null;
  reviewCount: number;
  averageRating: number | null;
  perfectCount: number;
  photoCount: number;
  commentCount: number;
  revisedRatingCount: number;
  raisedRatingCount: number;
  favorites: { reviewer: number; recipient: number; mutual: number };
  reactions: { emoji: string; count: number }[];
  ratingDistribution: Record<Tone, number>;
  participants: ParticipantStatistics[];
}
export interface ParticipantStatistics {
  userId: number;
  receivedCount: number;
  sentCount: number;
  averageRating: number | null;
  perfectCount: number;
  ratingDistribution: Record<Tone, number>;
}
export interface ReviewInput {
  rating: number;
  title: string;
  body: string;
  eventDate?: string;
  eventTime?: string;
  photoIds: string[];
  note?: string;
  revision?: number;
  designVariant?: number;
}
