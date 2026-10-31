// 파인튜닝 3차 재기: 시험 묶음 10개 × 3번 = 30편을 모델에 물어 형식을 점검하고(check.cjs) 제목·줄거리·이야기·그림 설명 전문을 적어요.
// 이야기가 이어지는지·뜻이 맞게 쓰였는지·그림 설명이 단어를 떠올리게 하는지는 사람이(또는 Claude가) 읽고 판정해요 (게임에 넣는 기준: 30편 가운데 27편).
//   WG_API=http://127.0.0.1:8099 node tools/finetune/v3/eval.cjs [이름]
//   WG_API: OpenAI 꼴 서버(llama.cpp의 llama-server 등). 생각 모드는 서버에서 꺼요 (--chat-template-kwargs '{"enable_thinking":false}')
//   서버(Cloudflare 이야기 서버, server/story-worker)로 재기:
//   WG_STORY=https://<이름>.workers.dev WG_TOKEN=<열쇠> [WG_MODEL=@cf/...] node tools/finetune/v3/eval.cjs <이름> [--regroup]
//   (서버가 규칙 글을 붙여 묻고, 이 스크립트는 단어만 보내요. 게임과 같은 길이에요)
//   --regroup: 시험 단어를 주제끼리 다시 묶은 regroup-prompts.json으로 재요
// 결과: tools/story-lab/v3-eval-<이름>.txt / .json (저장소에 넣지 않아요)
const fs = require('node:fs'), path = require('node:path');
const { REPO, TEST_SETS: SETS0, TRIES, prompt, parse, check, bootPage } = require('./check.cjs');

const API = (process.env.WG_API || '').replace(/\/$/, '');
const STORY = (process.env.WG_STORY || '').replace(/\/$/, '');
const NAME = process.argv.slice(2).find(a => !a.startsWith('--')) || 'run';
const TEST_SETS = process.argv.includes('--regroup') ? require('./regroup-prompts.json').map(s => s.words) : SETS0;
const OUT = path.join(REPO, 'tools', 'story-lab', `v3-eval-${NAME}`);
if (!API && !STORY) { console.error('WG_API=<서버 주소> 또는 WG_STORY=<이야기 서버 주소>를 주세요'); process.exit(2); }

// 이야기 서버: 단어만 보내요. 하루 무료 한도(429)를 넘으면 멈춰요
async function askStory(words) {
  const body = { words };
  if (process.env.WG_MODEL) body.model = process.env.WG_MODEL;
  const r = await fetch(STORY + '/story', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (process.env.WG_TOKEN || '') }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 429) { const e = new Error('하루 한도: ' + (j.error || '')); e.stop = true; throw e; }
  if (!r.ok) throw new Error('이야기 서버 ' + r.status + ': ' + String(j.error || '').slice(0, 200));
  return j.text || '';
}

// 모범 답안은 단어 7개에 400토큰쯤(가장 긴 것 510). 넉넉히 주되 끝없이 되풀이하면 끊어요
async function ask(text, n) {
  const body = { messages: [{ role: 'user', content: text }], temperature: 0.7, top_p: 0.9, max_tokens: 200 + 60 * (n + 2), stream: false };
  const r = await fetch(API + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('서버 ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}

async function main() {
  const p = bootPage(), txt = [], runs = [];
  const say = s => { console.log(s); txt.push(s); fs.writeFileSync(OUT + '.txt', txt.join('\n') + '\n'); };
  say(`# 이야기 재기 · ${NAME} · ${STORY ? STORY + ' ' + (process.env.WG_MODEL || '(서버 기본 모델)') : API}${process.argv.includes('--regroup') ? ' · 주제 묶음' : ''} · ${new Date().toISOString().slice(0, 16)}`);
  try {
    outer: for (let s = 0; s < TEST_SETS.length; s++) for (let k = 0; k < TRIES; k++) {
      const words = TEST_SETS[s], t0 = Date.now();
      let raw = '', err = '';
      try { raw = STORY ? await askStory(words) : await ask(prompt(words), words.length); } catch (e) { if (e.stop) { say('\n' + e.message + ' → 멈춰요 (내일 다시)'); break outer; } err = String((e && e.message) || e); }
      const out = parse(raw);
      const r = err ? { why: [err], warn: [] } : check(p, words, out);
      const run = { set: s + 1, try: k + 1, words: words.map(w => w[0]), ok: !r.why.length, why: r.why, warn: r.warn, ...out, raw, ms: Date.now() - t0 };
      runs.push(run);
      fs.writeFileSync(OUT + '.json', JSON.stringify({ name: NAME, api: API, runs }, null, 1));
      say(`\n[묶음 ${s + 1} · ${k + 1}번째] ${run.ok ? '형식 통과' : '형식 실패: ' + r.why.join(' · ')}${r.warn.length ? ' (참고: ' + r.warn.join(' · ') + ')' : ''} · ${(run.ms / 1000).toFixed(1)}초`);
      say(`  단어: ${words.map(w => w[0] + ' ' + w[1]).join(', ')}`);
      say(`  제목: ${out.title || '(없음)'}`);
      say(`  줄거리: ${out.plan || '(없음)'}`);
      out.lines.forEach((l, i) => say(`  ${i + 1}. ${l}`));
      out.pics.forEach(pc => say(`  [그림 ${pc.en || '?'}] ${pc.text}`));
      if (!out.title && !out.lines.length) say(`  (답 원문) ${String(raw).slice(0, 300).replace(/\n/g, ' / ')}`);
    }
  } finally { p.close(); }
  const bySet = TEST_SETS.map((_, s) => runs.filter(r => r.set === s + 1 && r.ok).length);
  say(`\n== ${NAME}: 형식 통과 ${runs.filter(r => r.ok).length}/${runs.length}편 (묶음별 ${bySet.join(' ')}) · 한 편 평균 ${(runs.reduce((a, r) => a + r.ms, 0) / runs.length / 1000).toFixed(1)}초 ==`);
  say('이야기가 이어지는지·뜻이 맞게 쓰였는지·그림 설명이 단어를 떠올리게 하는지는 위 글을 읽고 판정해요 (기준: 30편 가운데 27편).');
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
