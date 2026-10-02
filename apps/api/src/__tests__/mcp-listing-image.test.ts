import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchStoredListingPhotoForMcp, isStoredListingPhotoUrl } from "../lib/listing-photo.js";
import { mcpJsonWithImages } from "../mcp/tools/responses.js";

const ORIGIN = "https://proj.supabase.co";
const GOOD = `${ORIGIN}/storage/v1/object/public/listing-photos/a/b.jpg`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

describe("MCP listing photo image block", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.SUPABASE_URL = ORIGIN;
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("allows only the Supabase listing-photos public path", () => {
    expect(isStoredListingPhotoUrl(GOOD)).toBe(true);
    for (const bad of [
      "http://proj.supabase.co/storage/v1/object/public/listing-photos/a.jpg",
      "https://evil.example/storage/v1/object/public/listing-photos/a.jpg",
      `${ORIGIN}/storage/v1/object/public/other-bucket/a.jpg`,
      `${ORIGIN}/storage/v1/object/public/listing-photos/`,
      `${ORIGIN}.evil.example/storage/v1/object/public/listing-photos/a.jpg`,
      "https://127.0.0.1/storage/v1/object/public/listing-photos/a.jpg",
      "not a url",
    ]) {
      expect(isStoredListingPhotoUrl(bad)).toBe(false);
    }
  });

  it("does not fetch disallowed URLs", async () => {
    for (const u of ["https://evil.example/a.jpg", "http://127.0.0.1/a.jpg", null, ""]) {
      expect(await fetchStoredListingPhotoForMcp(u)).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a base64 image for an allowed URL, with redirect disabled", async () => {
    fetchMock.mockResolvedValue(
      new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const photo = await fetchStoredListingPhotoForMcp(GOOD);
    expect(photo).toEqual({ data: JPEG.toString("base64"), mimeType: "image/jpeg" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].redirect).toBe("error");
  });

  it("returns null on fetch error, non-200, oversize, or non-image", async () => {
    fetchMock.mockRejectedValueOnce(new Error("redirect"));
    expect(await fetchStoredListingPhotoForMcp(GOOD)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("x", { status: 404 }));
    expect(await fetchStoredListingPhotoForMcp(GOOD)).toBeNull();
    fetchMock.mockResolvedValueOnce(
      new Response(JPEG, { status: 200, headers: { "content-length": String(6 * 1024 * 1024) } }),
    );
    expect(await fetchStoredListingPhotoForMcp(GOOD)).toBeNull();
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    expect(await fetchStoredListingPhotoForMcp(GOOD)).toBeNull();
  });

  it("keeps the text block first and works with zero images", () => {
    const withImg = mcpJsonWithImages({ a: 1 }, [
      { type: "image", data: "QQ==", mimeType: "image/png" },
    ]);
    expect(withImg.content[0]).toEqual({ type: "text", text: '{"a":1}' });
    expect(withImg.content[1]).toMatchObject({ type: "image" });
    expect(mcpJsonWithImages({ a: 1 }, []).content).toHaveLength(1);
  });
});
