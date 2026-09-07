import { afterEach, describe, expect, it, vi } from "vitest";

const createBrowserClient = vi.fn((url: string, key: string) => ({ url, key }));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: (url: string, key: string) =>
    createBrowserClient(url, key),
}));

afterEach(() => {
  vi.resetModules();
  createBrowserClient.mockClear();
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("createClient", () => {
  it("returns a non-cached placeholder during SSR when public env is missing", async () => {
    const { createClient } = await import("./client");
    const first = createClient() as unknown as { url: string; key: string };
    const second = createClient() as unknown as { url: string; key: string };

    expect(first.url).toBe("https://placeholder.supabase.co");
    expect(first.key).toBe("placeholder-anon-key");
    expect(second).not.toBe(first);
    expect(createBrowserClient).toHaveBeenCalledTimes(2);
  });

  it("caches the real browser client once public env is set", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

    const { createClient } = await import("./client");
    const first = createClient();
    const second = createClient();

    expect(first).toBe(second);
    expect(createBrowserClient).toHaveBeenCalledTimes(1);
    expect(createBrowserClient).toHaveBeenCalledWith(
      "https://proj.supabase.co",
      "anon-key",
    );
  });
});
