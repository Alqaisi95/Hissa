/* خادم ثابت صغير للاختبار المحلي.
 *
 * سببه أن `python3 -m http.server` يخدم .webmanifest بنوع
 * application/octet-stream، فيرفض المتصفح قراءته مانيفستًا ولا تُثبَّت
 * الصفحة — وهو فشل صامت يضيع فيه وقت طويل قبل أن يُفهم أن الخلل في الخادم
 * لا في الملف. وهنا أيضًا تُضبط ترويسات لا يُخدم بدونها عامل الخدمة صحيحًا.
 *
 * 127.0.0.1 سياق آمن (potentially trustworthy) بحكم المواصفة، فعامل الخدمة
 * يعمل عليه دون شهادة — وهذا ما يجعل اختبار العمل دون اتصال ممكنًا محليًّا.
 *
 *   node demo/tools/serve.mjs [dir] [port]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || 'site');
const PORT = Number(process.argv[3] || 8731);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch (e) { res.writeHead(400); res.end('bad request'); return; }
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(ROOT, rel);
  /* لا خروج من الجذر مهما احتوى المسار من .. */
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('404'); return; }
    const ext = path.extname(file).toLowerCase();
    const head = { 'content-type': TYPES[ext] || 'application/octet-stream' };
    /* عامل الخدمة والمانيفست لا يُخزَّنان، وإلا لبقي المتصفح على نسخة قديمة
       من العامل نفسه فلا يصل أي تحديث أبدًا. */
    if (/sw\.js$|\.webmanifest$/.test(file)) head['cache-control'] = 'no-cache';
    res.writeHead(200, head);
    res.end(buf);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('يخدم ' + ROOT + ' على http://127.0.0.1:' + PORT + '/');
});
