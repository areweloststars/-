// 휴대폰 안 AI(WebLLM)를 화면과 따로 도는 일꾼에서 돌려요. 화면이 멈추지 않게.
// gpu-watch.js를 먼저 불러요: 그래픽 칩이 알려 주는 끊김·오류와 글 읽기 조각 시간을 화면에 보내요
import './gpu-watch.js';
import { WebWorkerMLCEngineHandler } from './web-llm.js';
const handler = new WebWorkerMLCEngineHandler();
// { wgPrefillChunk: n }: 올라와 있는 모델이 글을 n토큰씩 나눠 읽게 해요 (AI 진단이 크기를 바꿔 가며 재요).
// { wgPrefillGap: ms }: 조각 하나를 읽을 때마다 그래픽 칩을 ms만큼 쉬게 해요 (처음에는 모델 설정 wg_prefill_gap).
// 글을 쓰는 중이 아닐 때만 보내요. 조각 크기는 모델이 컴파일된 크기(512)보다 작을 때만 바뀌어요 (web-llm.js의 'word-game patch')
self.onmessage = msg => {
  const d = msg && msg.data;
  if (d && typeof d === 'object' && ('wgPrefillChunk' in d || 'wgPrefillGap' in d)) {
    const pipes = handler.engine && handler.engine.loadedModelIdToPipeline;
    for (const p of pipes ? pipes.values() : []) {
      if (p && 'wgPrefillChunk' in d && typeof p.wgSetPrefillChunk === 'function') p.wgSetPrefillChunk(d.wgPrefillChunk);
      if (p && 'wgPrefillGap' in d && typeof p.wgSetPrefillGap === 'function') p.wgSetPrefillGap(d.wgPrefillGap);
    }
    return;
  }
  handler.onmessage(msg);
};
