/**
 * sw.js — Service Worker для офлайн-режима и кэширования
 * Версия: 2.0
 */

const CACHE_NAME = 'burchess-v1';
const urlsToCache = [
  './',
  './index.html',
  './styles.css',
  './ui.js',
  './board.js',
  './movehistory.js',
  './sound.js',
  './animations.js',
  './settings.js',
  './bridge.js',
  './uci.js',
  './worker.js',
  './game.js',
  './engine_types.js',
  './engine_utils.js',
  './engine_bitboard.js',
  './engine_moves.js',
  './engine_position.js',
  './engine_movegen.js',
  './engine_tt.js',
  './engine_history.js',
  './engine_eval.js',
  './engine_nnue.js',
  './engine_search.js',
  './engine_time.js',
  './engine_opening.js',
  './engine_endgame.js',
  './engine_bench.js',
  './engine_threads.js',
  './engine_syzygy.js',
  './engine_uci.js',
  './engine_main.js',
  './manifest.json',
  './favicon.ico'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
});
