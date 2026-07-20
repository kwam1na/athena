// Warm, human line-art for the landing "goal" section — a shop owner's world,
// not systems diagrams. Each figure draws with rounded `currentColor` strokes,
// so callers set the tone via text color; a small primary accent (awning
// stripes, the loop's motion, the receipt's seal) carries the brand. Shapes
// that overlap are filled with the section's canvas color so crossings read as
// depth rather than clutter.

const CANVAS_FILL = "rgb(var(--app-canvas))";

type FigureProps = { className?: string };

// One place for the whole business: a friendly storefront.
export function OnePlaceFigure({ className }: FigureProps) {
  return (
    <svg
      viewBox="0 0 240 200"
      fill="none"
      className={className}
      aria-hidden="true"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* ground */}
      <path d="M50 156 H190" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />

      {/* shop body, door, windows */}
      <g stroke="currentColor" strokeOpacity="0.55" strokeWidth="2">
        <rect x="64" y="100" width="112" height="56" rx="6" />
        <rect x="102" y="124" width="36" height="32" rx="4" />
        <rect x="76" y="116" width="22" height="20" rx="3" />
        <rect x="142" y="116" width="22" height="20" rx="3" />
      </g>
      <circle cx="131" cy="141" r="1.8" fill="currentColor" fillOpacity="0.6" />

      {/* awning */}
      <path
        d="M58 88 H178 V100 q-10 11 -20 0 q-10 11 -20 0 q-10 11 -20 0 q-10 11 -20 0 q-10 11 -20 0 q-10 11 -20 0 Z"
        fill="currentColor"
        fillOpacity="0.04"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="2"
      />
      {/* awning stripes */}
      <g className="text-primary" stroke="currentColor" strokeOpacity="0.45" strokeWidth="2">
        <path d="M68 89 V106" />
        <path d="M88 89 V108" />
        <path d="M108 89 V106" />
        <path d="M128 89 V108" />
        <path d="M148 89 V106" />
        <path d="M168 89 V108" />
      </g>
    </svg>
  );
}

// The daily loop: the day (a sun) circled by the retail moments that repeat —
// a purchase, a payment, a package — with the loop's motion in primary.
export function WholeLoopFigure({ className }: FigureProps) {
  return (
    <svg
      viewBox="0 0 240 200"
      fill="none"
      className={className}
      aria-hidden="true"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* the loop */}
      <g className="text-primary">
        <circle
          cx="120"
          cy="100"
          r="52"
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="2"
          strokeDasharray="2 9"
        />
        <path d="M118 43 L126 49 L118 55 Z" fill="currentColor" fillOpacity="0.7" />
      </g>

      {/* shopping bag (right) — handles make it a bag, not a bin */}
      <g fill={CANVAS_FILL} stroke="currentColor" strokeOpacity="0.6" strokeWidth="2">
        <path
          d="M162 100 Q162 99 163 99 L177 99 Q178 99 178 100 L177 115 Q177 117 175 117 L165 117 Q163 117 163 115 Z"
        />
        <path d="M166 99 C166 90 174 90 174 99" fill="none" />
      </g>

      {/* price tag (left) */}
      <g fill={CANVAS_FILL} stroke="currentColor" strokeOpacity="0.6" strokeWidth="2">
        <path d="M60 100 L70 90 L80 90 Q82 90 82 92 L82 108 Q82 110 80 110 L70 110 Z" />
        <circle cx="73" cy="96" r="2" fill="none" strokeOpacity="0.5" />
      </g>

      {/* banknote (bottom) — cash */}
      <g fill={CANVAS_FILL} stroke="currentColor" strokeOpacity="0.6" strokeWidth="2">
        <rect x="101" y="143" width="38" height="20" rx="3.5" />
        <circle cx="120" cy="153" r="4.5" fill="none" strokeOpacity="0.55" />
        <path
          d="M108 150 V156 M132 150 V156"
          fill="none"
          strokeOpacity="0.4"
        />
      </g>
    </svg>
  );
}

// Evidence you can trust: a receipt, sealed with a check.
export function EvidenceFigure({ className }: FigureProps) {
  return (
    <svg
      viewBox="0 0 240 200"
      fill="none"
      className={className}
      aria-hidden="true"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <g transform="rotate(-4 120 100)">
        {/* receipt with torn bottom edge */}
        <path
          d="M98 58 Q98 50 106 50 L142 50 Q150 50 150 58 L150 138 L144 145 L138 138 L132 145 L126 138 L120 145 L114 138 L108 145 L102 138 L98 145 Z"
          fill={CANVAS_FILL}
          stroke="currentColor"
          strokeOpacity="0.55"
          strokeWidth="2"
        />
        {/* printed lines */}
        <g stroke="currentColor" strokeWidth="2.5">
          <path d="M108 72 H140" strokeOpacity="0.32" />
          <path d="M108 84 H134" strokeOpacity="0.32" />
          <path d="M108 96 H140" strokeOpacity="0.32" />
          <path d="M108 108 H128" strokeOpacity="0.32" />
          <path d="M108 128 H124" strokeOpacity="0.5" strokeWidth="3" />
        </g>
      </g>

      {/* seal */}
      <g className="text-primary">
        <circle
          cx="146"
          cy="134"
          r="13"
          fill={CANVAS_FILL}
          stroke="currentColor"
          strokeOpacity="0.9"
          strokeWidth="2"
        />
        <path
          d="M140 134 L145 139 L153 129"
          stroke="currentColor"
          strokeWidth="2.25"
        />
      </g>
    </svg>
  );
}
