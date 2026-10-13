import { describe, expect, it } from "vitest"
import { videoPageSite } from "./media-url"

describe("videoPageSite", () => {
  it("recognises YouTube and Vimeo watch pages", () => {
    expect(videoPageSite("https://youtu.be/0Ab-F7Y3IXc")).toBe("YouTube")
    expect(videoPageSite("https://www.youtube.com/watch?v=0Ab-F7Y3IXc")).toBe("YouTube")
    expect(videoPageSite("https://m.youtube.com/shorts/abc")).toBe("YouTube")
    expect(videoPageSite(" https://vimeo.com/123 ")).toBe("Vimeo")
  })

  it("leaves direct media files, other hosts and templated URLs alone", () => {
    expect(videoPageSite("https://cdn.example.com/coke.mp4")).toBeNull()
    expect(videoPageSite("https://example.com/poster.jpg")).toBeNull()
    expect(videoPageSite("https://notyoutube.com/x")).toBeNull()
    expect(videoPageSite("{{ vars.video_url }}")).toBeNull()
    expect(videoPageSite("not a url")).toBeNull()
    expect(videoPageSite("")).toBeNull()
  })
})
