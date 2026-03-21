const CACHE_NAME = 'roulette-pro-v2';
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './roulette_engine.js',
    './manifest.json',
    './icon-192.svg'
];

self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('fetch', e => {
    e.respondWith(
        caches.match(e.request).then(res => {
            return res || fetch(e.request);
        })
    );
});
