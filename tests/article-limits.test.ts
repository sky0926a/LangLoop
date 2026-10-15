import { afterEach, expect, it, vi } from "vitest";
import { infer } from "../src/provider";
import { defaults, Fault, type Inference } from "../src/core";
const request: Inference = { requestId: "11111111-1111-4111-8111-111111111111", operation: "article", providerId: "configured", text: "Translate", context: "", sourceLanguage: "auto", targetLanguage: "zh-TW", blocks: [{ id: "a", text: "Hello" }] };
const settings = { ...defaults, setupKind: "custom" as const, model: "fixture" };
const success = () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ translations: [{ id: "a", translation: "你好" }] }) } }] }));
afterEach(() => vi.useRealTimers());
it("waits Retry-After then resumes the same article batch after a transient 429", async () => {
 vi.useFakeTimers();
 const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 429, headers: { 'Retry-After': '2' } })).mockImplementationOnce(success);
 const pending = infer(request, settings, new AbortController().signal, fetcher);
 const checked = expect(pending).resolves.toEqual({ translations: [{ id: 'a', translation: '你好' }] });
 await vi.advanceTimersByTimeAsync(1999);
 expect(fetcher).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);
 await checked;
 expect(fetcher).toHaveBeenCalledTimes(2);
 expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
});
it("does not retry exhausted quota or expose provider response content", async () => {
 const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{code:'insufficient_quota',message:'private detail'}}), {status:429}));
 await expect(infer(request,settings,new AbortController().signal,fetcher)).rejects.toMatchObject({code:'quota_exceeded'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("cancels an article while waiting for rate limit recovery", async () => {
 vi.useFakeTimers();
 const fetcher = vi.fn().mockImplementation(() => new Response('{}', {status:429}));
 const controller = new AbortController();
 const pending = infer(request,settings,controller.signal,fetcher);
 const checked = expect(pending).rejects.toMatchObject({code:'cancelled'});
 await vi.advanceTimersByTimeAsync(1);
 controller.abort(new Fault('cancelled','Stopped.'));
 await checked;
 await vi.advanceTimersByTimeAsync(30000);
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("stops after two retries instead of looping indefinitely", async () => {
 vi.useFakeTimers();
 const fetcher = vi.fn().mockImplementation(() => new Response('{}', {status:429}));
 const checked = expect(infer(request,settings,new AbortController().signal,fetcher)).rejects.toMatchObject({code:'rate_limited'});
 await vi.advanceTimersByTimeAsync(6000);
 await checked;
 expect(fetcher).toHaveBeenCalledTimes(3);
});
it("does not retry before a long server cooldown", async () => {
 const fetcher = vi.fn().mockImplementation(() => new Response('{}', {status:429,headers:{'Retry-After':'120'}}));
 await expect(infer(request,settings,new AbortController().signal,fetcher)).rejects.toMatchObject({code:'rate_limited',retryAfterMs:120000});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("honors HTTP-date Retry-After", async () => {
 vi.useFakeTimers();
 vi.setSystemTime(new Date('2026-10-13T00:00:00Z'));
 const fetcher = vi.fn().mockResolvedValueOnce(new Response('{}', {status:429,headers:{'Retry-After':'Tue, 13 Oct 2026 00:00:03 GMT'}})).mockImplementationOnce(success);
 const checked = expect(infer(request,settings,new AbortController().signal,fetcher)).resolves.toHaveProperty('translations');
 await vi.advanceTimersByTimeAsync(2999);
 expect(fetcher).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(1);
 await checked;
 expect(fetcher).toHaveBeenCalledTimes(2);
});
it("does not retry writing requests or ambiguous server failures", async () => {
 for (const [operation,status] of [['explain',429],['article',500]] as const) {
  const fetcher = vi.fn().mockImplementation(() => new Response('{}', {status}));
  await expect(infer({...request,operation},settings,new AbortController().signal,fetcher)).rejects.toBeDefined();
  expect(fetcher).toHaveBeenCalledTimes(1);
 }
});
it("splits context-overflow batches and merges translations by original IDs", async () => {
 const blocks = ['a','b','c','d'].map(id => ({id,text:id}));
 const fetcher = vi.fn().mockImplementation((_url, init) => {
  const input = JSON.parse(JSON.parse(init.body).messages[1].content);
  return Promise.resolve(input.blocks.length > 2
    ? new Response(JSON.stringify({error:{code:'context_length_exceeded'}}),{status:400})
    : new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translations:input.blocks.map((b:{id:string})=>({id:b.id,translation:'譯'+b.id}))})}}]})));
 });
 await expect(infer({...request,blocks},settings,new AbortController().signal,fetcher)).resolves.toEqual({translations:blocks.map(b=>({id:b.id,translation:'譯'+b.id}))});
 expect(fetcher).toHaveBeenCalledTimes(3);
});
it("does not truncate an oversized single paragraph or retry it unchanged", async () => {
 const fetcher = vi.fn().mockImplementation(() => new Response(JSON.stringify({error:{message:'maximum context length exceeded'}}),{status:400}));
 await expect(infer(request,settings,new AbortController().signal,fetcher)).rejects.toMatchObject({code:'context_limit'});
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bounds recursive splitting and never retries unrelated HTTP 400 errors", async () => {
 const blocks = Array.from({length:40},(_,i)=>({id:String(i),text:'sample'}));
 const fetcher = vi.fn().mockImplementation((_url,init) => {
  const input = JSON.parse(JSON.parse(init.body).messages[1].content);
  if(input.blocks.length>1) return Promise.resolve(new Response(JSON.stringify({error:{code:'context_length_exceeded'}}),{status:400}));
  return Promise.resolve(new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({translations:[{id:input.blocks[0].id,translation:'譯'}]})}}]})));
 });
 await expect(infer({...request,blocks},settings,new AbortController().signal,fetcher)).rejects.toMatchObject({code:'context_limit'});
 expect(fetcher.mock.calls.length).toBeLessThanOrEqual(16);
 const invalid = vi.fn().mockImplementation(()=>new Response(JSON.stringify({error:{code:'invalid_model',message:'private'}}),{status:400}));
 await expect(infer({...request,blocks},settings,new AbortController().signal,invalid)).rejects.toMatchObject({code:'network_error'});
 expect(invalid).toHaveBeenCalledTimes(1);
});
