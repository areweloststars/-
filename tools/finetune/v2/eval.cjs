// 파인튜닝 2차 재기: 시험 묶음 10개 × 3번 = 30편을 모델에 물어 형식을 점검하고(check.cjs) 이야기 전문을 적어요.
// 이야기가 이어지는지·뜻이 맞게 쓰였는지는 사람이(또는 Claude가) 읽고 판정해요 (게임에 넣는 기준: 30편 가운데 27편).
//   WG_API=http://127.0.0.1:8099 node tools/finetune/v2/eval.cjs [이름]
//   WG_API: OpenAI 꼴 서버(llama.cpp의 llama-server 등). 생각 모드는 서버에서 꺼요 (--chat-template-kwargs '{"enable_thinking":false}')
// 결과: tools/story-lab/v2-eval-<이름>.txt / .json (저장소에 넣지 않아요)
const fs = require('node:fs'), path = require('node:path');
const { REPO, TEST_SETS, TRIES, prompt, parse, check, bootPage } = require('./check.cjs');

const API = (process.env.WG_API || '').replace(/\/$/, '');
const NAME = process.argv[2] || 'run';
const OUT = path.join(REPO, 'tools', 'story-lab', `v2-eval-${NAME}`);
if (!API) { console.error('WG_API=<서버 주소>를 주세요'); process.exit(2); }

async function ask(text, n) {
  const body = { messages: [{ role: 'user', content: text }], temperature: 0.7, top_p: 0.9, max_tokens: 80 + 60 * (n + 3), stream: false };
  const r = await fetch(API + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('서버 ' + r.status + ': ' + (await r.text()).slice(0, 200));
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
}

async function main() {
  const p = bootPage(), txt = [], runs = [];
  const say = s => { console.log(s); txt.push(s); fs.writeFileSync(OUT + '.txt', txt.join('\n') + '\n'); };
  say(`# 파인튜닝 2차 재기 · ${NAME} · ${API} · ${new Date().toISOString().slice(0, 16)}`);
  try {
    for (let s = 0; s < TEST_SETS.length; s++) for (let k = 0; k < TRIES; k++) {
      const words = TEST_SETS[s], t0 = Date.now();
      let raw = '', err = '';
      try { raw = await ask(prompt(words), words.length); } catch (e) { err = String((e && e.message) || e); }
      const { title, lines } = parse(raw);
      const r = err ? { why: [err], warn: [] } : check(p, words, title, lines);
      const run = { set: s + 1, try: k + 1, words: words.map(w => w[0]), ok: !r.why.length, why: r.why, warn: r.warn, title, lines, raw, ms: Date.now() - t0 };
      runs.push(run);
      fs.writeFileSync(OUT + '.json', JSON.stringify({ name: NAME, api: API, runs }, null, 1));
      say(`\n[묶음 ${s + 1} · ${k + 1}번째] ${run.ok ? '형식 통과' : '형식 실패: ' + r.why.join(' · ')}${r.warn.length ? ' (참고: ' + r.warn.join(' · ') + ')' : ''} · ${(run.ms / 1000).toFixed(1)}초`);
      say(`  단어: ${words.map(w => w[0] + ' ' + w[1]).join(', ')}`);
      say(`  제목: ${title || '(없음)'}`);
      lines.forEach((l, i) => say(`  ${i + 1}. ${l}`));
      if (!title && !lines.length) say(`  (답 원문) ${String(raw).slice(0, 300).replace(/\n/g, ' / ')}`);
    }
  } finally { p.close(); }
  const bySet = TEST_SETS.map((_, s) => runs.filter(r => r.set === s + 1 && r.ok).length);
  say(`\n== ${NAME}: 형식 통과 ${runs.filter(r => r.ok).length}/${runs.length}편 (묶음별 ${bySet.join(' ')}) · 한 편 평균 ${(runs.reduce((a, r) => a + r.ms, 0) / runs.length / 1000).toFixed(1)}초 ==`);
  say('이야기가 이어지는지·뜻이 맞게 쓰였는지는 위 이야기를 읽고 판정해요 (기준: 30편 가운데 27편).');
}
main().catch(e => { console.error('FAILED', e); process.exit(1); });
