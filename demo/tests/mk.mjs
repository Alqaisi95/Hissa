import fs from 'node:fs';
const body = fs.readFileSync('hissa-demo.html', 'utf8');
fs.writeFileSync('/tmp/app.html',
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${body}</body></html>`);
console.log('wrapper rebuilt,', body.length, 'bytes');
