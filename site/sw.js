/* حِصّة — عامل الخدمة (service worker)
 *
 * يُبنى منه site/sw.js عند تشغيل demo/tools/make_public.py، ويُستبدل
 * 11fb975b1e3f ببصمة محتوى الصفحة. فاسم المخزن يتغيّر كلما تغيّر التطبيق،
 * وهذا وحده ما يجعل التحديث يصل فعلًا بدل أن يبقى المستخدم على نسخة قديمة
 * لأن اسم المخزن لم يتحرك.
 *
 * ثلاث سياسات، لكل واحدة سبب:
 *
 *   التنقّل      → الشبكة أولًا، والمخزن احتياطًا.
 *                 التطبيق كلّه مستند واحد يحمل حالته بداخله؛ لو خُدم من
 *                 المخزن أولًا لظلّ المستخدم يرى حالة قديمة بعد كل نشر.
 *   بقية الأصول  → المخزن أولًا. أيقونات ومانيفست لا تتغيّر إلا مع البناء،
 *                 واسم المخزن يحمل البناء، فلا حاجة لسؤال الشبكة.
 *   خطوط Google  → المخزَّن فورًا مع تحديث في الخلفية. هذه هي التبعية
 *                 الخارجية الوحيدة في الصفحة، وبدونها تُقرأ بخط احتياطي —
 *                 فتخزينها هو الفرق بين «يعمل دون اتصال» و«يعمل ويبدو صحيحًا
 *                 دون اتصال».
 */
const BUILD = '11fb975b1e3f';
const SHELL = 'hissa-shell-' + BUILD;
const FONTS = 'hissa-fonts-v1';

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const FONT_HOSTS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

self.addEventListener('install', event => {
  /* لا skipWaiting هنا: العامل الجديد ينتظر حتى يقرّر المستخدم إعادة التحميل.
     القفز بالنسخة تحت يده وهو في منتصف نموذج ليس تحديثًا، بل فقدان عمل. */
  /* واحدًا واحدًا لا addAll: addAll ترفض الدفعة كلّها إذا سقط ملف واحد، فكان
     فشل أيقونة يترك المستند نفسه خارج المخزن — أي تطبيقًا يَعِد بالعمل دون
     اتصال ولا يفتح. الآن يسقط الملف وحده، ويبقى ما يفتح التطبيق. */
  event.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map(f => c.add(f).catch(() => {})));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(k => k.startsWith('hissa-') && k !== SHELL && k !== FONTS)
      .map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* الصفحة هي من تطلب التبديل، بعد أن يوافق من يقرأها. */
self.addEventListener('message', event => {
  if (event.data === 'hissa:skip-waiting') self.skipWaiting();
});

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const c = await caches.open(SHELL);
      c.put(request, fresh.clone());
    }
    return fresh;
  } catch (e) {
    const c = await caches.open(SHELL);
    return (await c.match(request))
        || (await c.match('./index.html'))
        || (await c.match('./'))
        || Response.error();
  }
}

async function cacheFirst(request) {
  const c = await caches.open(SHELL);
  const hit = await c.match(request);
  if (hit) return hit;
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) c.put(request, fresh.clone());
    return fresh;
  } catch (e) {
    return Response.error();
  }
}

/* استجابة الخط غالبًا مبهمة (opaque) لأن الطلب no-cors، فلا يُسأل عن status:
   تُخزَّن كما هي أو لا تُخزَّن. */
async function staleWhileRevalidate(request) {
  const c = await caches.open(FONTS);
  const hit = await c.match(request);
  const net = fetch(request).then(res => {
    if (res && (res.ok || res.type === 'opaque')) c.put(request, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (FONT_HOSTS.indexOf(url.origin) !== -1) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
  if (url.origin !== self.location.origin) return;   // لا نتدخّل في غير أصلنا
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }
  event.respondWith(cacheFirst(req));
});
