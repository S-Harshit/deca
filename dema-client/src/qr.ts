import qrcode from "qrcode-generator";

/** A QR code for some text, as an inline SVG string (black on white, with the quiet border scanners need). Made on this device. */
export function qrSvg(text: string): string {
  const qr = qrcode(0, "M"); // type 0 = pick the smallest version that fits; M = a little error correction
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
}

/** A short name for this device, for "move files between my devices". */
export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPad|Tablet/i.test(ua)) return "My tablet";
  if (/iPhone|Android.*Mobile|Mobile/i.test(ua)) return "My phone";
  return "My computer";
}
