import type { CoupleStatistics } from '../shared/types.js';
import { getTone } from '../shared/ratings.js';
import type { DB } from './db.js';

export function getCoupleStatistics(db: DB): CoupleStatistics {
  const started = db.prepare("SELECT registered_at FROM users WHERE role = 'recipient'").get();
  const reviews = db.prepare('SELECT rating, photo_ids FROM reviews').all();
  const distribution: CoupleStatistics['ratingDistribution'] = { gold: 0, rose: 0, paper: 0, ember: 0, inferno: 0 };
  const photos = new Set<string>();
  let sum = 0;
  for (const review of reviews) {
    const rating = Number(review.rating);
    distribution[getTone(rating)]++;
    sum += rating;
    for (const id of JSON.parse(String(review.photo_ids))) photos.add(id);
  }
  const favorites = { reviewer: 0, recipient: 0, mutual: 0 };
  for (const row of db.prepare('SELECT u.role, COUNT(*) AS n FROM favorites f JOIN users u ON u.id = f.user_id GROUP BY u.role').all()) {
    favorites[row.role as 'reviewer' | 'recipient'] = Number(row.n);
  }
  favorites.mutual = Number(db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT f.review_id FROM favorites f JOIN users u ON u.id = f.user_id
      GROUP BY f.review_id HAVING COUNT(DISTINCT u.role) = 2
    )
  `).get()!.n);
  return {
    startedAt: started?.registered_at ? String(started.registered_at) : null,
    reviewCount: reviews.length,
    averageRating: reviews.length ? sum / reviews.length / 10 : null,
    perfectCount: distribution.gold,
    photoCount: photos.size,
    commentCount: Number(db.prepare('SELECT COUNT(*) AS n FROM comments').get()!.n),
    revisedRatingCount: Number(db.prepare('SELECT COUNT(*) AS n FROM reviews r WHERE EXISTS (SELECT 1 FROM revisions v WHERE v.review_id = r.id AND v.rating <> r.rating)').get()!.n),
    raisedRatingCount: Number(db.prepare('SELECT COUNT(*) AS n FROM reviews r WHERE r.rating > (SELECT rating FROM revisions v WHERE v.review_id = r.id ORDER BY id LIMIT 1)').get()!.n),
    favorites,
    reactions: db.prepare('SELECT emoji, COUNT(*) AS n FROM reactions GROUP BY emoji ORDER BY emoji').all().map(row => ({ emoji: String(row.emoji), count: Number(row.n) })),
    ratingDistribution: distribution,
  };
}
