// 휴대폰 안 AI(WebLLM)를 화면과 따로 도는 일꾼에서 돌려요. 화면이 멈추지 않게.
import { WebWorkerMLCEngineHandler } from './web-llm.js';
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = msg => { handler.onmessage(msg); };
