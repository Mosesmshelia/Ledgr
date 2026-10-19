// WhatsApp "click to chat" links. Opens WhatsApp with the message typed in; the person presses Send themselves.

/** Nigerian numbers to international format without "+": 0803 123 4567 → 2348031234567. Returns null if it doesn't look like a phone number. */
export function normalizePhone(raw: string | null | undefined, defaultCountry = "234"): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) d = d.slice(1);
  else if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = defaultCountry + d.slice(1);
  else if (d.length === 10) d = defaultCountry + d;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

/** A wa.me link. Without a phone number WhatsApp asks who to send it to. */
export function whatsappLink(text: string, phone?: string | null): string {
  const n = normalizePhone(phone);
  return `https://wa.me/${n ?? ""}?text=${encodeURIComponent(text)}`;
}
