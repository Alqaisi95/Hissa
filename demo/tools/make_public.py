#!/usr/bin/env python3
"""Build site/index.html — the public, static-hosting copy of the live page.

Two things separate the public copy from the one on the private share link:

  1. Accounts that real people registered are removed. The live state carries
     their e-mail and the hash of their password; a public URL is not the place
     for either. Only seeded demo accounts survive.

  2. A line in the footer says plainly that nothing saves for anyone else,
     because a static host has no artifact runtime to publish through.

Run from the repository root:  python3 demo/tools/make_public.py
"""
import io, json, os, re, sys

SRC = 'demo/hissa-live.html'
OUT = 'site/index.html'
# The seeded accounts, and only those, belong on a public URL.
DEMO_DOMAINS = ('@example.om', '@hissa.om')

NOTE = ('<p style="color:var(--ink-3)">هذه نسخة استعراضية على استضافة ثابتة:'
        ' كل شيء يعمل، لكن ما تغيّره يبقى في تبويبك ولا يُحفظ لغيرك ولا يبقى بعد'
        ' إعادة التحميل. النسخة التي تحفظ للجميع تعمل على رابط المشاركة الخاص.</p>')
ANCHOR = '<p style="color:var(--ink-3)">نسخة تجريبية تعمل داخل متصفحك.'


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
    # Audit rows naming a removed account go with it. The chain is recomputed
    # from scratch on every load, so a shortened log still verifies.
    st['audit'] = [a for a in st['audit']
                   if a.get('entity') not in ids and a.get('actor') not in ids]

    body = json.dumps(st, ensure_ascii=False).replace('<', '\\u003c')
    out = src[:m.start()] + m.group(1) + body + m.group(3) + src[m.end():]
    if ANCHOR not in out:
        sys.exit('the footer anchor moved — update NOTE/ANCHOR in this script')
    out = out.replace(ANCHOR, NOTE + ANCHOR, 1)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    io.open(OUT, 'w', encoding='utf-8').write(
        '<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        + out + '\n</body>\n</html>')

    print('removed %d real account(s): %s'
          % (len(real), ', '.join(u.get('email', u['id']) for u in real) or '—'))
    print('%s · %d accounts · %d audit rows · %d bytes'
          % (OUT, len(st['users']), len(st['audit']), os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
