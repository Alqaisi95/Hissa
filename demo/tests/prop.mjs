import fs from 'node:fs';
/* Lift the real functions out of the shipped file so the test cannot drift
   from the code it claims to test. */
const src = fs.readFileSync('hissa-demo.html', 'utf8');
const lift = re => new Function('return ' + src.match(re)[0])();
const proRata = lift(/function proRata\(total, weights\) \{[\s\S]*?\n\}/);
const h64 = lift(/function h64\(str\) \{[\s\S]*?\n\}/);

let seed = 20260825;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const ri = n => Math.floor(rnd() * n);

let checked = 0, fails = [];
const fail = (name, detail) => fails.push(name + ' — ' + detail);

console.log('══ proRata invariants, 20,000 random cases ══');
for (let t = 0; t < 20000; t += 1) {
  const n = 1 + ri(12);
  const weights = Array.from({ length: n }, () => ri(9) === 0 ? 0 : 1 + ri(5_000_000));
  const total = ri(20) === 0 ? 0 : 1 + ri(200_000_000);
  const parts = proRata(total, weights);
  checked += 1;

  const sum = parts.reduce((a, b) => a + b, 0);
  if (sum !== total && weights.some(w => w > 0))
    fail('sums to total', `total=${total} sum=${sum} w=[${weights}]`);
  if (parts.some(x => x < 0)) fail('no negative share', `w=[${weights}] p=[${parts}]`);
  if (parts.some(x => !Number.isInteger(x))) fail('integers only', `p=[${parts}]`);
  if (parts.some((x, i) => weights[i] === 0 && x !== 0))
    fail('zero weight gets zero', `w=[${weights}] p=[${parts}]`);
  /* monotone: a strictly larger weight never receives strictly less */
  for (let i = 0; i < n; i += 1) for (let j = 0; j < n; j += 1)
    if (weights[i] > weights[j] && parts[i] < parts[j])
      fail('monotone in weight', `w[${i}]=${weights[i]}>w[${j}]=${weights[j]} but ${parts[i]}<${parts[j]}`);
  /* largest-remainder bound: nobody is off their exact share by a whole unit */
  const ws = weights.reduce((a, b) => a + b, 0);
  if (ws > 0) parts.forEach((x, i) => {
    const exact = (total * weights[i]) / ws;
    if (x < Math.floor(exact) || x > Math.ceil(exact))
      fail('within one unit of the exact share', `exact=${exact} got=${x}`);
  });
}
console.log(`  ${checked} cases · ${fails.length ? fails.length + ' FAILURES' : 'all invariants hold'}`);
[...new Set(fails)].slice(0, 5).forEach(f => console.log('   ✗', f));

console.log('\n══ determinism ══');
{
  const w = [40000000, 30000000, 12000000, 8000000, 110000];
  const a = JSON.stringify(proRata(78000000, w));
  const b = JSON.stringify(proRata(78000000, w));
  const c = JSON.stringify(proRata(78000000, w.slice()));
  console.log('  same input, same output:', a === b && b === c, a);
}

console.log('\n══ degenerate inputs ══');
const deg = [
  ['all weights zero', () => proRata(1000, [0, 0, 0])],
  ['single holder',    () => proRata(7, [5])],
  ['total below count',() => proRata(2, [1, 1, 1, 1, 1])],
  ['total zero',       () => proRata(0, [1, 2, 3])],
  ['empty list',       () => proRata(100, [])],
  ['one huge one tiny',() => proRata(1000000, [999999999, 1])],
];
deg.forEach(([name, f]) => {
  let out;
  try { out = JSON.stringify(f()); } catch (e) { out = 'THREW ' + e.message; }
  console.log('  ' + name.padEnd(20), out);
});

console.log('\n══ the allocation redistribution loop ══');
/* The rule: a share scaled under the minimum ticket is refunded whole and its
   money redistributed, repeatedly, until nothing is left under the minimum. */
const MIN = 100000;
function allocate(ceiling, requests) {
  let alloc = proRata(ceiling, requests);
  for (let pass = 0; pass < requests.length; pass += 1) {
    const under = alloc.map((a, i) => ({ a, i })).filter(x => x.a > 0 && x.a < MIN);
    if (!under.length) return { alloc, passes: pass };
    under.forEach(x => { alloc[x.i] = 0; });
    const w = alloc.map((a, i) => (a > 0 ? requests[i] : 0));
    if (w.every(x => x === 0)) return { alloc, passes: pass, exhausted: true };
    alloc = proRata(ceiling, w);
  }
  return { alloc, passes: requests.length, ranOut: true };
}
let aFails = [], maxPasses = 0, ranOut = 0;
for (let t = 0; t < 5000; t += 1) {
  const n = 1 + ri(10);
  const reqs = Array.from({ length: n }, () => MIN + ri(50_000_000));
  const total = reqs.reduce((a, b) => a + b, 0);
  const ceiling = 1 + ri(total);
  const { alloc, passes, ranOut: ro, exhausted } = allocate(ceiling, reqs);
  maxPasses = Math.max(maxPasses, passes);
  if (ro) { ranOut += 1; aFails.push('did not converge in n passes'); }
  if (!exhausted) {
    const got = alloc.reduce((a, b, i) => a + Math.min(b, reqs[i]), 0);
    const ref = reqs.reduce((a, r, i) => a + (r - Math.min(alloc[i], r)), 0);
    if (got + ref !== total) aFails.push(`allocated+refunded≠requested (${got}+${ref}≠${total})`);
    if (alloc.some(x => x > 0 && x < MIN)) aFails.push('a share survived below the minimum');
    if (got > ceiling) aFails.push(`allocated ${got} exceeds ceiling ${ceiling}`);
  }
}
console.log(`  5000 cases · max passes ${maxPasses} · non-convergent ${ranOut} · ${aFails.length ? aFails.length + ' FAILURES' : 'all invariants hold'}`);
[...new Set(aFails)].slice(0, 5).forEach(f => console.log('   ✗', f));

console.log('\n══ the audit hash ══');
{
  const a = h64('x'), b = h64('x'), c = h64('y');
  const long = h64('ا'.repeat(5000));
  console.log('  deterministic:', a === b, '· distinct inputs differ:', a !== c);
  console.log('  fixed width  :', new Set([a.length, c.length, long.length]).size === 1, `(${a.length} hex)`);
  const seen = new Set();
  for (let i = 0; i < 200000; i += 1) seen.add(h64('حِصّة-' + i));
  console.log('  200k distinct inputs →', seen.size, 'distinct digests · collisions:', 200000 - seen.size);
}
process.exit(fails.length + aFails.length ? 1 : 0);
