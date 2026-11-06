// Show the latest actual rating change, not an arrow between equal numbers
// after a text edit or after returning to the original score.
export function lastRatingChange(review: { rating: number; revisions: readonly { rating: number }[] }): { from: number; to: number } | null {
  const previous = [...review.revisions].reverse().find(version => version.rating !== review.rating);
  return previous ? { from: previous.rating, to: review.rating } : null;
}
