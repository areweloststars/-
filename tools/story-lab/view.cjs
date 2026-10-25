// 실험 결과 보기: node view.cjs out.json
const out = JSON.parse(require('node:fs').readFileSync(process.argv[2], 'utf8'));
console.log(`모델 ${out.model} · 올리기 ${out.loadMs}ms`);
for (const r of out.runs) {
  console.log(`\n■ set ${r.set} seed ${r.seed} · ${r.design} · ${r.title} · ${r.error ? 'ERROR ' + r.error : `${r.ms}ms · 읽은 ${r.usage && r.usage.prompt_tokens} 쓴 ${r.usage && r.usage.completion_tokens}`}`);
  if (r.error) continue;
  const plan = (r.text.match(/^계획: .*$/m) || [''])[0];
  if (plan) console.log('  ' + plan);
  console.log('  [시작] ' + r.intro.join(' '));
  r.lines.forEach((l, i) => {
    const x = r.items[i] || {}, c = r.checks[i] || {};
    console.log(`  ${i + 1}. (${x.id}·${x.who || '-'}) ${l}${c.cast ? '' : '  ⚠인물 없음'}${c.why ? '  ⚠' + c.why : ''}`);
  });
  console.log('  [끝] ' + r.outro.join(' '));
}
if (out.errors && out.errors.length) console.log('\npage errors:', out.errors);
