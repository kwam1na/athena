import { C, addBg, card, label, title } from "./theme.mjs";

const loops = [
  ["Sell", "POS, online checkout, orders", C.blue],
  ["Control", "drawers, approvals, daily close", C.green],
  ["Replenish", "stock pressure, POs, receiving", C.gold],
  ["Serve", "intake, appointments, cases", C.red],
  ["Learn", "storefront behavior, history", "#6B5AA8"],
];

export async function slide02(presentation, ctx) {
  const slide = presentation.slides.add();
  addBg(slide, ctx);
  label(slide, ctx, "WHY NOW");
  title(slide, ctx, "Small operators do not need more apps. They need one control loop.", 54, 88, 780, 130);
  ctx.addText(slide, { text: "Athena turns the messy daily flow into one operating rhythm:", x: 58, y: 250, w: 570, h: 28, fontSize: 22, color: C.muted });
  const x0 = 72;
  loops.forEach(([head, desc, color], i) => {
    const x = x0 + i * 232;
    card(slide, ctx, x, 336, 188, 126, C.white, C.line);
    ctx.addShape(slide, { x: x + 16, y: 354, w: 12, h: 72, fill: color });
    ctx.addText(slide, { text: head, x: x + 42, y: 352, w: 126, h: 34, fontSize: 24, bold: true, color: C.ink });
    ctx.addText(slide, { text: desc, x: x + 42, y: 392, w: 124, h: 46, fontSize: 14, color: C.muted });
    if (i < loops.length - 1) {
      ctx.addText(slide, { text: "→", x: x + 197, y: 374, w: 24, h: 34, fontSize: 28, bold: true, color: C.muted });
    }
  });
  ctx.addText(slide, { text: "Every action leaves evidence for the next one.", x: 350, y: 540, w: 570, h: 42, fontSize: 30, bold: true, color: C.green, align: "center" });
  return slide;
}
