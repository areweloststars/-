// 휴대폰 안 AI(WebLLM)를 화면과 따로 도는 일꾼에서 돌려요. 화면이 멈추지 않게.
// gpu-watch.js를 먼저 불러요: 그래픽 칩이 알려 주는 끊김·오류를 화면에 보내요 (문제 찾기용)
import './gpu-watch.js';
import { WebWorkerMLCEngineHandler } from './web-llm.js';
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = msg => { handler.onmessage(msg); };
