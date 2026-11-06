export type Role = 'reviewer' | 'recipient';
export interface User {
  id: number;
  name: string;
  role: Role;
  avatarId: string | null;
}
export interface Revision {
  id: number;
  rating: number;
  title: string;
  body: string;
  eventDate: string;
  photoIds: string[];
  note: string;
  createdAt: string;
  userId: number;
}
export interface ReviewComment {
  id: number;
  userId: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}
export interface Review {
  id: number;
  authorId: number;
  rating: number;
  title: string;
  body: string;
  eventDate: string;
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
}
export interface ReviewInput {
  rating: number;
  title: string;
  body: string;
  eventDate: string;
  photoIds: string[];
  note?: string;
  revision?: number;
  designVariant?: number;
}
