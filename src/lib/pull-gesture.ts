export const pullThreshold = 72;

export class PullGesture {
  private origin: { x: number; y: number } | null = null;
  private captured = false;
  distance = 0;
  begin(x: number, y: number, scrollTop: number, touches: number) {
    this.cancel();
    if (scrollTop <= 1 && touches === 1) this.origin = { x, y };
  }
  move(x: number, y: number, touches: number): number | null {
    if (!this.origin) return null;
    if (touches !== 1) { this.cancel(); return null; }
    const dx = Math.abs(x - this.origin.x), dy = y - this.origin.y;
    if (!this.captured) {
      if (dy < -8 || dx > 8 && dx > dy) { this.cancel(); return null; }
      if (dy < 8) return null;
      this.captured = true;
    }
    this.distance = Math.min(112, Math.max(0, dy * 0.5));
    return this.distance;
  }
  release() {
    const refresh = this.captured && this.distance >= pullThreshold;
    this.cancel();
    return refresh;
  }
  cancel() { this.origin = null; this.captured = false; this.distance = 0; }
}
