// 이야기 서버에 묻는 도구 (eval-group.cjs가 써요, 2026-11-06). 흘려 받기 글 읽기·연결이 끊기면 한 번 더·120초에서 끊기면 생각 메모로 다시 쓰기.
// eval-server.cjs에도 같은 것이 들어 있어요 (그쪽은 그대로 두었어요).
// 하루 무료 10,000 Neuron을 얼마나 쓰는지: Cloudflare 요금표(2026-10-31)의 백만 토큰당 Neuron (입력, 출력)
const PRICES = { '@cf/nvidia/nemotron-3-120b-a12b': [45455, 136364] };
// 흘려 받기 끝 조각의 usage에 Cloudflare가 센 Neuron이 와요 (2026-11-08 확인: 토큰으로 센 값과 같아요). 있으면 그것을 써요
const neurons = steps => steps.reduce((a, s) => { if (s.neurons != null) return a + s.neurons; const p = PRICES[s.model]; return p && s.in != null ? a + (s.in * p[0] + (s.out || 0) * p[1]) / 1e6 : a; }, 0);

// 흘려 받기 글: 답 글(content)과 생각 글(reasoning_content)을 따로 모아요. 쓴 토큰은 마지막 조각(usage)에
function readSSE(raw) {
  let text = '', usage = null, think = 0, reasoning = '', err = '';
  for (const line of String(raw).split(/\r?\n/)) {
    const m = line.match(/^data:\s?(.*)$/), d = m && m[1].trim();
    if (!d || d === '[DONE]') continue;
    let j;
    try { j = JSON.parse(d); } catch { continue; }
    if (j.error || j.errors) err = JSON.stringify(j.error || j.errors).slice(0, 300);
    const c = j.choices && j.choices[0], dl = c && (c.delta || c.message);
    if (dl) { if (typeof dl.content === 'string') text += dl.content; const t = String(dl.reasoning_content || dl.reasoning || ''); think += t.length; reasoning += t; }
    else if (typeof j.response === 'string') text += j.response;
    if (j.usage) usage = j.usage;
  }
  return { text, usage, think, reasoning, err };
}

// api: 서버 주소, token: 열쇠, W: 서버 코드의 _ (clean·broken·parseJSON·MAX_NOTES·MODELS), rescue: 끊기면 생각 메모로 다시 쓰기
// keepThinking (2026-11-11 사용자가 정함, '이어 생각하기'): 120초에서 끊기면 그때까지의 생각 글을 메모로 보내고 생각을 켠 채(같은 effort)
// 다시 물어요 → 요청마다 2분씩 더 생각해요 (2번까지 = 6분까지). 그래도 끊기면 마지막에만 생각 끔으로 써요.
// (생각 끔으로 바로 다시 쓴 이야기는 3편 가운데 1편만 좋았고, 생각을 마친 이야기는 4편 모두 좋았어요)
function client({ api, token, W, rescue = true, keepThinking = 2 }) {
  let lastIn = 1345; // 끊겨서 usage가 없을 때 쓰는 어림 (쓰기 요청 입력 토큰)
  // 답 글이 쓸모없는지: 이야기는 서버의 broken, 묶음은 JSON에 groups가 없으면
  const useless = (route, t) => (route === '/group' ? !((W.parseJSON(t) || {}).groups || []).length : W.broken(t));
  async function postOnce(route, body) {
    const t0 = Date.now();
    const r = await fetch(api + route, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
    if (r.ok && /event-stream/i.test(r.headers.get('content-type') || '')) {
      const s = readSSE(await r.text()), u = s.usage || {};
      // 생각 끔(effort none)이면 Nemotron의 답 글이 생각 칸(reasoning)으로 와요 (2026-11-08 확인: content는 비고 reasoning에 이야기 글)
      if (!s.text.trim() && body.effort === 'none' && s.reasoning.trim()) { s.text = s.reasoning; s.reasoning = ''; s.think = 0; }
      if (u.prompt_tokens && !body.notes) lastIn = u.prompt_tokens;
      const step = { step: route === '/group' ? (body.draft ? 'review' : 'group') : route === '/fix' ? 'fix' : 'write', model: body.model || W.MODELS[0], effort: body.effort, ms: Date.now() - t0, think: s.think, ...(u.neurons != null ? { neurons: u.neurons } : {}),
        in: u.prompt_tokens ?? (body.notes ? lastIn + Math.round(body.notes.length / 3.2) : lastIn), out: u.completion_tokens ?? Math.round(s.think / 3.2 + s.text.length / 1.5), ...(s.usage ? {} : { est: true }) };
      if (!s.text.trim()) throw Object.assign(new Error(`흘려 받은 답이 비었어요${s.err ? ': ' + s.err : ''} (생각 글 ${s.think}자, ${(step.ms / 1000).toFixed(0)}초)`), { server: true, cut: true, reasoning: s.reasoning, step });
      return { text: route === '/group' ? s.text.trim() : W.clean(s.text), stream: true, reasoning: s.reasoning, steps: [step] };
    }
    const j = await r.json().catch(() => ({}));
    if (r.status === 429) throw Object.assign(new Error('하루 무료 한도: ' + String(j.error || '').slice(0, 160)), { stop: true });
    if (!r.ok) throw Object.assign(new Error(`서버 ${r.status}: ${String(j.error || '').slice(0, 300)}`), { server: true });
    return j;
  }
  // 연결이 끊긴 것만 한 번 더 (서버가 준 오류·하루 한도는 그대로)
  async function post(route, body) {
    try { return await postOnce(route, body); } catch (e) { if (e.stop || e.server) throw e; return postOnce(route, body); }
  }
  async function again(route, body, reasoning, before) {
    let notes = String(reasoning || '').trim().slice(-W.MAX_NOTES).trim(), steps = before.slice();
    if (!notes) throw Object.assign(new Error('끊긴 흘려 받기에 생각 글도 없어요'), { server: true, steps });
    // 이어 생각하기: 생각을 켠 채 메모를 주고 다시 (끊기면 새 생각 글을 메모 뒤에 이어 붙여요)
    if (body.effort && body.effort !== 'none') {
      for (let k = 1; k <= keepThinking; k++) {
        try {
          const x = await post(route, { ...body, notes });
          if (!useless(route, x.text)) return { ...x, rescued: true, continued: k, notes, steps: [...steps, ...x.steps.map(s => ({ ...s, step: 'continue' + k }))] };
          steps = [...steps, ...x.steps.map(s => ({ ...s, step: 'continue' + k }))];
          notes = (notes + '\n\n' + String(x.reasoning || '')).trim().slice(-W.MAX_NOTES).trim();
        } catch (e) {
          if (e.stop || !e.cut) throw Object.assign(e, { steps: [...steps, ...(e.step ? [{ ...e.step, step: 'continue' + k }] : [])], notes });
          steps = [...steps, { ...e.step, step: 'continue' + k }];
          notes = (notes + '\n\n' + String(e.reasoning || '')).trim().slice(-W.MAX_NOTES).trim();
        }
      }
    }
    // 마지막: 생각 끔으로 메모대로 써요 (답이 꼭 오게)
    try {
      const x = await post(route, { ...body, effort: 'none', notes });
      return { ...x, rescued: true, continued: 0, notes, steps: [...steps, ...x.steps.map(s => ({ ...s, step: 'rescue' }))] };
    } catch (e) {
      throw Object.assign(e, { message: '생각 메모로 다시 썼지만 ' + e.message, steps: [...steps, ...(e.step ? [{ ...e.step, step: 'rescue' }] : [])], rescueThinking: e.reasoning, notes, step: undefined });
    }
  }
  // 묻기: 120초에서 끊기거나(답 없음) 답이 쓸모없으면, rescue면 모은 생각 글로 생각 끔 다시 쓰기 / 아니면 한 번 더
  async function ask(route, body) {
    let r;
    try { r = await post(route, body); } catch (e) {
      if (!(rescue && e.cut && route !== '/fix')) throw e;
      return again(route, body, e.reasoning, [e.step]);
    }
    if (!r.stream || !useless(route, r.text)) return r;
    if (rescue && route !== '/fix') return again(route, body, r.reasoning, r.steps);
    const x = await post(route, body);
    return { ...x, steps: [...r.steps, ...x.steps.map(s => ({ ...s, step: s.step + '-again' }))] };
  }
  return { ask, post };
}

module.exports = { readSSE, client, neurons, PRICES };
