import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import {
  buildWhatsAppEntryUrl,
  campaignEntryKeyword,
  normalizeWhatsAppNumber,
} from "./whatsapp-link";

describe("normalizeWhatsAppNumber", () => {
  it("strips the plus, spaces and punctuation", () => {
    expect(normalizeWhatsAppNumber("+27 79 863 7339")).toBe("27798637339");
    expect(normalizeWhatsAppNumber("+27 (79) 863-7339")).toBe("27798637339");
  });

  it("rejects numbers wa.me can't use", () => {
    expect(normalizeWhatsAppNumber("079 863 7339")).toBeNull(); // national format, leading 0
    expect(normalizeWhatsAppNumber("12345")).toBeNull();
    expect(normalizeWhatsAppNumber("")).toBeNull();
    expect(normalizeWhatsAppNumber(null)).toBeNull();
  });
});

describe("campaignEntryKeyword", () => {
  it("uses the first of a comma-separated keyword list", () => {
    expect(campaignEntryKeyword("BMWTEST2026, BMW")).toBe("BMWTEST2026");
    expect(campaignEntryKeyword(" SAVE ")).toBe("SAVE");
    expect(campaignEntryKeyword("")).toBeNull();
    expect(campaignEntryKeyword(null)).toBeNull();
  });
});

describe("buildWhatsAppEntryUrl", () => {
  it("builds the Hollard Pay as You Drive entry link", () => {
    expect(buildWhatsAppEntryUrl("+27 79 863 7339", "SAVE")).toBe(
      "https://wa.me/27798637339?text=SAVE",
    );
  });

  it("encodes keywords with spaces or symbols", () => {
    expect(buildWhatsAppEntryUrl("27798637339", "WIN BIG & NOW")).toBe(
      "https://wa.me/27798637339?text=WIN%20BIG%20%26%20NOW",
    );
  });

  it("omits the prefill when there is no keyword, and refuses a bad number", () => {
    expect(buildWhatsAppEntryUrl("27798637339", null)).toBe("https://wa.me/27798637339");
    expect(buildWhatsAppEntryUrl("0798637339", "SAVE")).toBeNull();
  });

  it("QR code carries the full link, not just the number", () => {
    const url = buildWhatsAppEntryUrl("27798637339", "SAVE")!;
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const encoded = qr.segments
      .map((s) => (typeof s.data === "string" ? s.data : Buffer.from(s.data as Uint8Array).toString()))
      .join("");
    expect(encoded).toBe("https://wa.me/27798637339?text=SAVE");
  });
});
