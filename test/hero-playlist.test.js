import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO_VIDEOS, pickSegment, pickVideo } from '../public/js/hero-playlist.js';

const videos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('the playlist has unique, well-formed YouTube ids', () => {
  const ids = HERO_VIDEOS.map((v) => v.id);
  assert.equal(new Set(ids).size, ids.length, 'без повторов');
  assert.ok(ids.length >= 8, 'достаточно разнообразия');
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{11}$/);
});

test('pickVideo is random across the whole list', () => {
  assert.equal(pickVideo(videos, { random: () => 0 }).id, 'a');
  assert.equal(pickVideo(videos, { random: () => 0.5 }).id, 'b');
  assert.equal(pickVideo(videos, { random: () => 0.999 }).id, 'c');
  assert.equal(pickVideo(videos, { random: () => 1 }).id, 'c', 'крайнее значение не выходит за массив');
});

test('pickVideo never repeats excluded videos (last shown, failed attempts)', () => {
  for (const r of [0, 0.34, 0.7, 0.99]) {
    assert.notEqual(pickVideo(videos, { exclude: ['a', 'b'], random: () => r }).id, 'a');
    assert.equal(pickVideo(videos, { exclude: ['a', 'b'], random: () => r }).id, 'c');
  }
});

test('pickVideo falls back to the full list when everything is excluded', () => {
  assert.ok(['a', 'b', 'c'].includes(pickVideo(videos, { exclude: ['a', 'b', 'c'], random: () => 0.4 }).id));
});

test('the picks are spread over the playlist (no stuck choice)', () => {
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) seen.add(pickVideo(HERO_VIDEOS).id);
  assert.equal(seen.size, HERO_VIDEOS.length);
});

test('every playlist item has a positive integer duration', () => {
  for (const { id, duration } of HERO_VIDEOS) assert.ok(Number.isInteger(duration) && duration > 0, id);
});

test('pickSegment keeps the loop away from the intro and the end credits', () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999999]) {
    const { start, end } = pickSegment(900, { random: () => r });
    assert.equal(end - start, 75, 'длина отрезка фиксирована');
    assert.ok(start >= 8, `заставка пропущена (start=${start})`);
    assert.ok(end <= 900 - 60, `титры не попадают в отрезок (end=${end})`);
  }
});

test('pickSegment varies the start and takes short videos whole', () => {
  const starts = new Set([0, 0.2, 0.4, 0.6, 0.8].map((r) => pickSegment(1200, { random: () => r }).start));
  assert.equal(starts.size, 5);
  assert.deepEqual(pickSegment(83), { start: 0, end: 83 });
  assert.deepEqual(pickSegment(102), { start: 0, end: 102 });
});

test('every playlist item yields a valid segment inside the video', () => {
  for (const { id, duration } of HERO_VIDEOS) {
    for (let i = 0; i < 50; i += 1) {
      const { start, end } = pickSegment(duration);
      assert.ok(start >= 0 && end <= duration && start < end, `${id}: ${start}–${end} из ${duration}`);
    }
  }
});
