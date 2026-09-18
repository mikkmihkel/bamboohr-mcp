import { describe, expect, it, vi } from "vitest";
import { createTtlCache } from "../src/metaCache";

describe("createTtlCache", () => {
  it("loads once within the TTL and reloads after it", async () => {
    let t = 1000;
    const cache = createTtlCache(500, () => t);
    const load = vi.fn(async () => ({ v: t }));
    expect(await cache.get("tables", load)).toEqual({ v: 1000 });
    t = 1400;
    expect(await cache.get("tables", load)).toEqual({ v: 1000 });
    t = 1600;
    expect(await cache.get("tables", load)).toEqual({ v: 1600 });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed load", async () => {
    const cache = createTtlCache(500, () => 0);
    const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(new Error("boom")).mockResolvedValue("ok");
    await expect(cache.get("k", load)).rejects.toThrow("boom");
    await expect(cache.get("k", load)).resolves.toBe("ok");
  });

  it("keys are independent and clear() empties everything", async () => {
    const cache = createTtlCache(500, () => 0);
    await cache.get("a", async () => 1);
    await cache.get("b", async () => 2);
    const reload = vi.fn(async () => 3);
    cache.clear();
    expect(await cache.get("a", reload)).toBe(3);
  });
});
