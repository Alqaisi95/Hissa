import re, json
s = open('hissa-demo.html', encoding='utf-8').read()
script = re.search(r'<script id="appscript">(.*?)\n</script>', s, re.S).group(1)
style  = re.search(r'<style id="appstyle">(.*?)</style>', s, re.S).group(1)
state  = json.loads(re.search(r'<script id="appstate" type="application/json">(.*?)</script>', s, re.S).group(1))

print("═══ 1. functions and consts defined but never referenced again ═══")
defs = set()
for m in re.finditer(r'^(?:function (\w+)|(?:const|let) (\w+) *= *(?:\(|function|async|\[|\{))', script, re.M):
    defs.add(m.group(1) or m.group(2))
dead = []
for name in sorted(defs):
    uses = len(re.findall(r'\b' + re.escape(name) + r'\b', script))
    if uses <= 1:
        dead.append(name)
print("  ", ', '.join(dead) if dead else 'none')

print("\n═══ 2. CSS classes defined but never emitted ═══")
css_cls = set(re.findall(r'\.([a-z][a-z0-9_-]*(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?)\s*[,{:]', style))
unused = []
for c in sorted(css_cls):
    if c in ('mono','num','muted','sm','xs','stack','row','spacer','n'): continue
    if re.search(r'["\' ]' + re.escape(c) + r'["\' ]', script) or ("'" + c) in script or (' ' + c + "'") in script:
        continue
    if c in script: continue
    unused.append(c)
print("  ", ', '.join(unused) if unused else 'none')

print("\n═══ 3. ACTS handlers never referenced by any data-act ═══")
acts = set(re.findall(r'^  ([a-zA-Z]\w*): *(?:async )?(?:\(|d =>|\(\) =>|d,)', script, re.M))
emitted = set(re.findall(r"data-act=[\"']([a-zA-Z]\w*)", script))
print("   defined not emitted:", ', '.join(sorted(acts - emitted)) or 'none')
print("   emitted not defined:", ', '.join(sorted(emitted - acts)) or 'none')

print("\n═══ 4. permissions: granted vs checked ═══")
granted = set()
for u in state['users']:
    granted |= set(u.get('perms') or [])
checked = set(re.findall(r"can\(\w+, *'([a-z.]+)'\)", script)) | set(re.findall(r"perm: *'([a-z.]+)'", script)) \
        | set(re.findall(r"includes\('([a-z.]+)'\)", script)) | set(re.findall(r"anyOf: *\['([a-z.]+)', *'([a-z.]+)'\]", script)[0] if re.findall(r"anyOf: *\['([a-z.]+)', *'([a-z.]+)'\]", script) else [])
cat = set(re.findall(r"k: '([a-z.]+)', +ar:", script))
print("   granted but never checked:", ', '.join(sorted(granted - checked)) or 'none')
print("   checked but never granted:", ', '.join(sorted(checked - granted)) or 'none')
print("   in the admin catalogue but not granted to anyone:", ', '.join(sorted(cat - granted)) or 'none')
print("   granted but missing from the admin catalogue:", ', '.join(sorted(granted - cat)) or 'none')

print("\n═══ 5. state shape ═══")
for k, v in state.items():
    print("   %-18s %s" % (k, len(v) if isinstance(v, (list, dict)) else type(v).__name__))
print("\n═══ 6. size ═══")
print("   script %d KB · style %d KB · state %d KB · total %d KB"
      % (len(script)/1024, len(style)/1024, len(json.dumps(state))/1024, len(s)/1024))
