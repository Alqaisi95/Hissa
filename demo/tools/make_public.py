#!/usr/bin/env python3
"""Build site/ — the public, static-hosting copy of the live page.

Three things separate the public copy from the one on the private share link:

  1. Accounts that real people registered are removed. The live state carries
     their e-mail and the hash of their password; a public URL is not the place
     for either. Only seeded demo accounts survive.

  2. A line in the footer says plainly that nothing saves for anyone else,
     because a static host has no artifact runtime to publish through.

  3. The progressive-web-app files are assembled here, and only here. A service
     worker needs a same-origin script and a top-level page; inside the
     artifact frame there is neither, so demo/hissa-live.html stays free of all
     of it. The application registers a worker only when it finds a manifest
     link beside it — which is to say, only in this build.

     The worker's cache name carries a fingerprint of index.html. Without it
     the name never changes, the browser keeps serving the copy it already
     holds, and a deploy silently reaches nobody.

Run from the repository root:  python3 demo/tools/make_public.py
"""
import hashlib, io, json, os, re, shutil, sys

SRC = 'demo/hissa-live.html'
OUT = 'site/index.html'
SITE = 'site'
PWA = 'demo/pwa'
# The seeded accounts, and only those, belong on a public URL.
DEMO_DOMAINS = ('@example.om', '@hissa.om')

NOTE = ('<p style="color:var(--ink-3)">هذه نسخة استعراضية على استضافة ثابتة:'
        ' كل شيء يعمل، لكن ما تغيّره يبقى في تبويبك ولا يُحفظ لغيرك ولا يبقى بعد'
        ' إعادة التحميل. النسخة التي تحفظ للجميع تعمل على رابط المشاركة الخاص.</p>')
ANCHOR = '<p style="color:var(--ink-3)">نسخة تجريبية تعمل داخل متصفحك.'

# Everything here is relative on purpose: GitHub Pages serves a project
# repository under /<repo>/, not at the root, and an absolute start_url or
# worker path would point at a directory that does not exist there.
HEAD_EXTRA = (
    '<link rel="manifest" href="./manifest.webmanifest">\n'
    '<meta name="theme-color" content="#0d5c58">\n'
    '<meta name="application-name" content="حِصّة">\n'
    '<meta name="apple-mobile-web-app-capable" content="yes">\n'
    '<meta name="apple-mobile-web-app-title" content="حِصّة">\n'
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">\n'
    '<link rel="apple-touch-icon" href="./icons/icon-192.png">\n'
    '<link rel="icon" type="image/png" sizes="512x512" href="./icons/icon-512.png">\n'
)


def h64(text):
    """FNV-1a 64, byte for byte the h64() inside the page."""
    prime, mask = 0x100000001b3, (1 << 64) - 1
    value = 0xcbf29ce484222325
    for ch in text:
        value ^= ord(ch)
        value = (value * prime) & mask
    return format(value, '016x')


def rechain(rows):
    """Rewrite prev/hash so the shortened log verifies against the page's own
    check. Mirrors appendAudit(): the hash covers the row with `prev` set and
    `hash` absent, serialised in its existing key order."""
    prev = '0' * 16
    for row in rows:
        body = {k: v for k, v in row.items() if k != 'hash'}
        body['prev'] = prev
        row['prev'] = prev
        row['hash'] = h64(prev + '|' + json.dumps(body, ensure_ascii=False, separators=(',', ':')))
        prev = row['hash']


def build_pwa(index_bytes):
    """Copy the worker, manifest and icons into site/, stamping the build."""
    missing = [p for p in (os.path.join(PWA, 'sw.js'),
                           os.path.join(PWA, 'manifest.webmanifest'),
                           os.path.join(PWA, 'icons'))
               if not os.path.exists(p)]
    if missing:
        sys.exit('missing PWA sources: %s\nrun: node demo/tools/make_icons.mjs'
                 % ', '.join(missing))

    build = hashlib.sha256(index_bytes).hexdigest()[:12]
    sw = io.open(os.path.join(PWA, 'sw.js'), encoding='utf-8').read()
    if '__BUILD__' not in sw:
        sys.exit('demo/pwa/sw.js no longer carries __BUILD__ — the cache name '
                 'would stop changing and updates would stop reaching anyone')
    io.open(os.path.join(SITE, 'sw.js'), 'w', encoding='utf-8').write(
        sw.replace('__BUILD__', build))

    shutil.copyfile(os.path.join(PWA, 'manifest.webmanifest'),
                    os.path.join(SITE, 'manifest.webmanifest'))
    icons_out = os.path.join(SITE, 'icons')
    if os.path.isdir(icons_out):
        shutil.rmtree(icons_out)
    shutil.copytree(os.path.join(PWA, 'icons'), icons_out)
    return build


def main():
    src = io.open(SRC, encoding='utf-8').read()
    m = re.search(r'(<script id="appstate" type="application/json">)(.*?)(</script>)',
                  src, re.S)
    if not m:
        sys.exit(SRC + ': no state block found')
    st = json.loads(m.group(2))

    real = [u for u in st['users']
            if not (u.get('email') or '').endswith(DEMO_DOMAINS)]
    ids = {u['id'] for u in real}
    st['users'] = [u for u in st['users'] if u['id'] not in ids]
    # Audit rows naming a removed account go with it — and then the chain has
    # to be rebuilt.
    #
    # The note that used to sit here said a shortened log "still verifies
    # because the chain is recomputed from scratch on every load". It is not:
    # auditIntegrity() recomputes and *compares*, so every row after a removal
    # fails, and the reader is shown a broken audit trail on a page whose whole
    # argument is that the trail cannot be tampered with. Removing a row is a
    # legitimate edit made by this build; re-linking is what makes the
    # remaining log honest rather than merely shorter.
    st['audit'] = [a for a in st['audit']
                   if a.get('entity') not in ids and a.get('actor') not in ids]
    rechain(st['audit'])

    body = json.dumps(st, ensure_ascii=False).replace('<', '\\u003c')
    out = src[:m.start()] + m.group(1) + body + m.group(3) + src[m.end():]
    if ANCHOR not in out:
        sys.exit('the footer anchor moved — update NOTE/ANCHOR in this script')
    out = out.replace(ANCHOR, NOTE + ANCHOR, 1)

    os.makedirs(SITE, exist_ok=True)
    page = ('<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
            + HEAD_EXTRA
            + out + '\n</body>\n</html>').encode('utf-8')
    io.open(OUT, 'wb').write(page)

    build = build_pwa(page)

    print('removed %d real account(s): %s'
          % (len(real), ', '.join(u.get('email', u['id']) for u in real) or '—'))
    print('%s · %d accounts · %d audit rows · %d bytes'
          % (OUT, len(st['users']), len(st['audit']), os.path.getsize(OUT)))
    print('pwa · build %s · sw.js + manifest + %d icon(s)'
          % (build, len(os.listdir(os.path.join(SITE, 'icons')))))


if __name__ == '__main__':
    main()
