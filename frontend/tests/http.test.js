import test from "node:test";
import assert from "node:assert/strict";
import { request } from "../src/services/http.js";
test("transport preserves API error codes and never retries uncertain delivery", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      throw new Error("timeout");
    };
    await assert.rejects(
      request("/messages/reply", { method: "POST", body: "{}" }),
      (e) => e.code === "DELIVERY_UNKNOWN",
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () => ({
      ok: false,
      json: async () => ({
        error: { code: "REPLY_IN_PROGRESS", message: "処理中" },
      }),
    });
    await assert.rejects(
      request("/messages/reply", { method: "POST" }),
      (e) => e.code === "REPLY_IN_PROGRESS",
    );
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    });
    await assert.rejects(
      request("/messages/reply", { method: "POST" }),
      (e) => e.code === "DELIVERY_UNKNOWN",
    );
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    });
    assert.deepEqual(await request("/contacts"), { data: [] });
  } finally {
    globalThis.fetch = original;
  }
});
