import { C, addBg, card, label, pill, title } from "./theme.mjs";

export async function slide08(presentation, ctx) {
  const slide = presentation.slides.add();
  addBg(slide, ctx, C.ink);
  label(slide, ctx, "THE ASK", 58, 48, "#91C7A9");
  title(slide, ctx, "Athena helps one owner run like a team.", 58, 110, 700, 116, C.white);
  ctx.addText(slide, { text: "The pitch is simple: compress the daily back office into one calm control surface, then let every sale, stock move, service case, and cash action strengthen the next decision.", x: 64, y: 260, w: 670, h: 90, fontSize: 24, color: "#DDE4E0" });
  const items = [
    ["Fewer blind spots", "cash, stock, orders, services, approvals"],
    ["Faster handoffs", "daily open, close, queues, staff work"],
    ["Better customer memory", "online behavior plus transaction history"],
    ["Owner leverage", "the system remembers what the owner cannot"],
  ];
  items.forEach(([a,b], i) => {
    const x = 72 + (i % 2) * 540;
    const y = 416 + Math.floor(i / 2) * 102;
    card(slide, ctx, x, y, 470, 70, "#182330", "#344457");
    ctx.addText(slide, { text: a, x: x + 24, y: y + 14, w: 240, h: 24, fontSize: 20, bold: true, color: C.white });
    ctx.addText(slide, { text: b, x: x + 24, y: y + 42, w: 390, h: 18, fontSize: 13, color: "#BFC9D1" });
  });
  pill(slide, ctx, "Run the business from the operating day outward", 382, 640, 516, "#91C7A9", C.ink);
  return slide;
}
