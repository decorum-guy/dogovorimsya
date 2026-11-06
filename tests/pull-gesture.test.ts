import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PullGesture, pullThreshold } from '../src/lib/pull-gesture.js';

test('pull refresh arms only at the top and fires once on release', () => {
  const gesture = new PullGesture();
  gesture.begin(100, 100, 0, 1);
  assert.equal(gesture.move(102, 100 + pullThreshold * 2, 1), pullThreshold);
  assert.equal(gesture.distance, pullThreshold, 'holding a finger keeps the gesture armed');
  assert.equal(gesture.release(), true);
  assert.equal(gesture.release(), false, 'the same gesture cannot refresh twice');
});
test('short pulls, retraction, cancellation and multi-touch do not refresh', () => {
  const gesture = new PullGesture();
  gesture.begin(0, 0, 0, 1); gesture.move(0, 143, 1); assert.equal(gesture.release(), false);
  gesture.begin(0, 0, 0, 1); gesture.move(0, 220, 1); gesture.move(0, 30, 1); assert.equal(gesture.release(), false);
  gesture.begin(0, 0, 0, 1); gesture.move(0, 220, 1); gesture.cancel(); assert.equal(gesture.release(), false);
  gesture.begin(0, 0, 0, 1); gesture.move(0, 220, 2); assert.equal(gesture.release(), false);
  gesture.begin(0, 0, 0, 2); assert.equal(gesture.move(0, 220, 1), null); assert.equal(gesture.release(), false);
});
test('regular scrolling and horizontal swipes stay native; large pulls have resistance', () => {
  const gesture = new PullGesture();
  gesture.begin(0, 0, 30, 1); assert.equal(gesture.move(0, 300, 1), null);
  gesture.begin(0, 0, 0, 1); assert.equal(gesture.move(80, 10, 1), null); assert.equal(gesture.move(80, 300, 1), null);
  gesture.begin(0, 100, 0, 1); assert.equal(gesture.move(0, 80, 1), null); assert.equal(gesture.move(0, 400, 1), null);
  gesture.begin(0, 0, 0, 1); assert.equal(gesture.move(0, 1000, 1), 112); assert.equal(gesture.release(), true);
});
