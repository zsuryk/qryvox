import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAnyPackFile } from "../lib/pack";

afterEach(() => vi.unstubAllGlobals());

describe("finding a document among the packs", () => {
  it("reads Larkspur's folder first, then the others, and returns the first that serves it", async () => {
    const served: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      served.push(url);
      return url === "/pack/wrenfield/wrenfield-ppm-excerpt.pdf" ? new Response(new Uint8Array([1, 2, 3])) : new Response("", { status: 404 });
    });

    expect([...(await fetchAnyPackFile("wrenfield-ppm-excerpt.pdf"))]).toEqual([1, 2, 3]);
    expect(served).toEqual(["/pack/wrenfield-ppm-excerpt.pdf", "/pack/v2/wrenfield-ppm-excerpt.pdf", "/pack/wrenfield/wrenfield-ppm-excerpt.pdf"]);
  });

  it("says why the first place failed when no pack serves it", async () => {
    vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
    await expect(fetchAnyPackFile("nowhere.pdf")).rejects.toThrow("GET /pack/nowhere.pdf: 404");
  });
});
