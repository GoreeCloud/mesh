import test from "node:test";
import assert from "node:assert/strict";
import { createPdfProviderContract } from "./adapter.mjs";
import { createStirlingHttpsTransport } from "./stirling-transport.mjs";

const sample = new TextEncoder().encode("%PDF-1.4\n% synthetic test only\n%%EOF\n");
const good = () => ({ status: 200, contentType: "application/pdf", bytes: sample });
const request = (operation = "compress", files = [sample]) => ({ operation, files });
const permit = async () => true;

test("default policy denies before transport", async () => {
  let calls = 0;
  const p = createPdfProviderContract({ transport: async () => { calls++; return good(); } });
  assert.deepEqual(await p.process(request()), { ok: false, error: { code: "denied" } });
  assert.equal(calls, 0);
});
test("compress has fixed POST path, validated options and cloned inputs/results", async () => {
  const p = createPdfProviderContract({
    permit, transport: async incoming => {
      assert.equal(incoming.method, "POST");
      assert.equal(incoming.path, "/api/v1/misc/compress-pdf");
      assert.deepEqual(incoming.fields, { optimizeLevel: "5", linearize: "false", normalize: "false", grayscale: "false" });
      assert.notEqual(incoming.files[0], sample);
      assert.deepEqual(incoming.files[0], sample);
      return good();
    },
  });
  const output = await p.process(request());
  assert.equal(output.ok, true);
  assert.notEqual(output.bytes, sample);
  assert.deepEqual(output.bytes, sample);
});
test("merge preserves input ordering and uses only reviewed route", async () => {
  const p = createPdfProviderContract({ permit, transport: async incoming => {
    assert.equal(incoming.path, "/api/v1/general/merge-pdfs");
    assert.equal(incoming.files.length, 2);
    assert.deepEqual(incoming.fields, {});
    return good();
  } });
  assert.equal((await p.process(request("merge", [sample, sample]))).ok, true);
});
test("bad operations, counts, headers, sizes and accessor-backed requests fail closed", async () => {
  let calls = 0;
  const p = createPdfProviderContract({ permit, maxInputBytes: 64, transport: async () => { calls++; return good(); } });
  for (const req of [
    request("delete"), request("merge"), request("compress", [sample, sample]),
    request("compress", [new Uint8Array([1, 2, 3])]),
    { ...request(), optimizeLevel: 10 },
    { ...request(), arbitraryUrl: "https://example.org" },
    { ...request("merge", [sample, sample]), optimizeLevel: 5 },
    { operation: "compress", files: [new Uint8Array(128)] },
    Object.defineProperty({ ...request() }, "operation", { get() { throw Error("secret"); } }),
    { operation: "compress", files: new Array(1) },
  ]) {
    assert.equal((await p.process(req)).error.code, "invalid_request");
  }
  assert.equal(calls, 0);
});
test("deny, throw and non-boolean approvals never invoke provider", async () => {
  let called = 0;
  for (const approve of [() => false, () => "yes", () => { throw Error("secret credential"); }]) {
    const p = createPdfProviderContract({ permit: approve, transport: async () => { called++; return good(); } });
    assert.equal((await p.process(request())).error.code, "denied");
  }
  assert.equal(called, 0);
});
test("untrusted provider outputs are rejected and error text is not leaked", async () => {
  for (const bad of [
    { ...good(), status: 302 }, { ...good(), status: 401 },
    { ...good(), contentType: "text/html" },
    { ...good(), bytes: new TextEncoder().encode("<html>not a pdf</html>") },
    { ...good(), secret: "never include in response" },
    Object.defineProperty({ ...good() }, "bytes", { get() { throw Error("secret"); } }),
  ]) {
    const p = createPdfProviderContract({ permit, transport: async () => bad });
    assert.deepEqual(await p.process(request()), { ok: false, error: { code: "invalid_response" } });
  }
  const p = createPdfProviderContract({ permit, transport: async () => { throw Error("private request body"); } });
  assert.deepEqual(await p.process(request()), { ok: false, error: { code: "unavailable" } });
});
test("timeout holds concurrency until underlying transport finishes", async () => {
  let finish;
  const p = createPdfProviderContract({
    permit, maxInFlight: 1, timeoutMs: 15,
    transport: () => new Promise(resolve => { finish = resolve; }),
  });
  const first = p.process(request());
  const result = await first;
  assert.equal(result.error.code, "timed_out");
  assert.equal(p.inFlight(), 1);
  assert.equal((await p.process(request())).error.code, "unavailable");
  finish(good());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(p.inFlight(), 0);
});
test("strict constructor configuration", () => {
  for (const config of [{}, { transport: 42 }, { transport: () => good(), maxInFlight: 0 },
    { transport: () => good(), maxOutputBytes: 0 }, { transport: () => good(), timeoutMs: 0 }]) {
    assert.throws(() => createPdfProviderContract(config), TypeError);
  }
});
test("server transport uses only fixed HTTPS origin and separately injected token", async () => {
  let seen = 0;
  const t = createStirlingHttpsTransport({
    getServiceToken: () => "service-test-key-12345",
    fetchImpl: async (url, options) => {
      seen++;
      assert.equal(url, "https://stirling-pdf.goreecloud.com/api/v1/misc/compress-pdf");
      assert.equal(options.headers["X-API-KEY"], "service-test-key-12345");
      assert.equal(options.redirect, "manual");
      assert.equal(options.credentials, "omit");
      assert.equal(options.body.getAll("fileInput").length, 1);
      assert.equal(options.body.get("linearize"), "false");
      return new Response(sample, { status: 200, headers: { "content-type": "application/pdf" } });
    },
  });
  const p = createPdfProviderContract({ permit, transport: t });
  const result = await p.process(request());
  assert.equal(result.ok, true);
  assert.equal(seen, 1);
});
test("HTTP redirect, large streaming responses and invalid token fail closed", async () => {
  const initial = { method: "POST", path: "/api/v1/misc/compress-pdf",
    fields: {}, files: [sample], signal: new AbortController().signal };
  const invalidToken = createStirlingHttpsTransport({ getServiceToken: () => "bad\nsecret", fetchImpl: () => { throw Error("should not fetch"); } });
  await assert.rejects(invalidToken(initial), /Service credential not available/);
  const redirect = createStirlingHttpsTransport({
    getServiceToken: () => "service-test-key-12345",
    fetchImpl: async () => new Response(null, { status: 302, headers: { Location: "https://other.example/" } }),
  });
  const p = createPdfProviderContract({ permit, transport: redirect });
  assert.equal((await p.process(request())).error.code, "invalid_response");
  const oversized = createStirlingHttpsTransport({
    getServiceToken: () => "service-test-key-12345", maxOutputBytes: 16,
    fetchImpl: async () => new Response(new Uint8Array(40), { status: 200, headers: { "content-type": "application/pdf" } }),
  });
  const p2 = createPdfProviderContract({ permit, transport: oversized });
  assert.equal((await p2.process(request())).error.code, "unavailable");
});
