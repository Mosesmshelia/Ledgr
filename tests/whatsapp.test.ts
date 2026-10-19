import { describe, it, expect } from "vitest";
import { normalizePhone, whatsappLink } from "@/lib/whatsapp";

describe("WhatsApp links", () => {
  it("turns Nigerian numbers into international format", () => {
    expect(normalizePhone("0803 123 4567")).toBe("2348031234567");
    expect(normalizePhone("+234 803 123 4567")).toBe("2348031234567");
    expect(normalizePhone("2348031234567")).toBe("2348031234567");
    expect(normalizePhone("8031234567")).toBe("2348031234567");
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
  it("builds a wa.me link with the message encoded", () => {
    expect(whatsappLink("Total ₦4,500 & thanks", "08031234567")).toBe("https://wa.me/2348031234567?text=Total%20%E2%82%A64%2C500%20%26%20thanks");
    expect(whatsappLink("Hi")).toBe("https://wa.me/?text=Hi");
  });
});
