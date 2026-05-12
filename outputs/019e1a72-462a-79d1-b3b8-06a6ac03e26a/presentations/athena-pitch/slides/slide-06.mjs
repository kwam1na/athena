import { C, addBg, card, label, screenshot, title } from "./theme.mjs";

export async function slide06(presentation, ctx) {
  const slide = presentation.slides.add();
  addBg(slide, ctx);
  label(slide, ctx, "SERVE");
  title(slide, ctx, "Services are real operations, not side notes.", 54, 78, 520, 128);
  await screenshot(slide, ctx, "06-service-intake-clean.png", 610, 74, 560, 430);
  const rows = [
    ["Capture", "walk-in or booked service work"],
    ["Assign", "staff owner, priority, channel"],
    ["Collect", "deposit and customer details"],
    ["Operate", "appointments, active cases, catalog rules"],
  ];
  rows.forEach(([a,b], i) => {
    const y = 268 + i * 72;
    card(slide, ctx, 76, y, 440, 50, "#FFFFFF", C.line);
    ctx.addText(slide, { text: a, x: 96, y: y + 12, w: 118, h: 22, fontSize: 18, bold: true, color: C.green });
    ctx.addText(slide, { text: b, x: 222, y: y + 14, w: 260, h: 22, fontSize: 15, color: C.muted });
  });
  ctx.addText(slide, { text: "Retail + service workflows can share one customer and stock truth.", x: 82, y: 590, w: 500, h: 42, fontSize: 24, bold: true, color: C.ink });
  return slide;
}
