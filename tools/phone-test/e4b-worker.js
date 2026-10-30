// E4B 휴대폰 시험 페이지의 일꾼. 게임의 일꾼(word-game/llm/worker.js)처럼 엔진을 돌리되, 엔진(web-llm.js)을 불러올 때
// 모델 조각을 8MB씩 나눠 그래픽 칩에 올리는 길(stream-load.js)을 끼워 넣어요. 게임 파일은 고치지 않아요.
// 예전처럼 조각을 통째로 읽어 한 번에 올리면, 8GB 폰에서 93조각 중 6조각(1.37GB)을 올리고 탭이 꺼졌어요.
import '../../word-game/llm/gpu-watch.js';
import { wgStreamShard, patchWebLLM } from './stream-load.js';

// 엔진을 고쳐 불러오는 동안 온 메시지(모델 올리기 요청)는 모아 뒀다가 넘겨요
const early = [];
let handler = null;
self.onmessage = msg => (handler ? handler.onmessage(msg) : early.push(msg));
globalThis.wgStreamShard = wgStreamShard;
globalThis.wgStreamLoad = 8 * 2 ** 20;

const res = await fetch(new URL('../../word-game/llm/web-llm.js', import.meta.url));
if (!res.ok) throw new Error(`web-llm.js를 받지 못했어요 (${res.status})`);
const url = URL.createObjectURL(new Blob([patchWebLLM(await res.text())], { type: 'text/javascript' }));
const { WebWorkerMLCEngineHandler } = await import(url);
URL.revokeObjectURL(url);
handler = new WebWorkerMLCEngineHandler();
for (const msg of early.splice(0)) handler.onmessage(msg);
