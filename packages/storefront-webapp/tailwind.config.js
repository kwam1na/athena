/** @satisfies {import('tailwindcss').Config} */
export default {
  content: {
    relative: true,
    files: ["./src/**/*.{js,ts,jsx,tsx}"],
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        numeric: ["var(--font-numeric)"],
        lavish: ["var(--font-display)"],
      },
      maxWidth: {
        content: "var(--container-content)",
      },
      borderRadius: {
        lg: "var(--radius-surface)",
        md: "var(--radius-control)",
        sm: "calc(var(--radius-control) - 2px)",
        pill: "var(--radius-pill)",
      },
      spacing: {
        "layout-2xs": "var(--space-2xs)",
        "layout-xs": "var(--space-xs)",
        "layout-sm": "var(--space-sm)",
        "layout-md": "var(--space-md)",
        "layout-lg": "var(--space-lg)",
        "layout-xl": "var(--space-xl)",
        "layout-2xl": "var(--space-2xl)",
        "layout-3xl": "var(--space-3xl)",
        "control-compact": "var(--control-height-compact)",
        "control-standard": "var(--control-height-standard)",
        "control-comfortable": "var(--control-height-comfortable)",
        gutter: "var(--page-gutter)",
        "safe-top": "var(--safe-area-top)",
        "safe-right": "var(--safe-area-right)",
        "safe-bottom": "var(--safe-area-bottom)",
        "safe-left": "var(--safe-area-left)",
      },
      colors: {
        canvas: "hsl(var(--canvas))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          subtle: "hsl(var(--surface-subtle))",
          raised: "hsl(var(--surface-raised))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        brand: {
          DEFAULT: "hsl(var(--brand))",
          foreground: "hsl(var(--brand-foreground))",
        },
        action: {
          DEFAULT: "hsl(var(--action))",
          foreground: "hsl(var(--action-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        selection: {
          DEFAULT: "hsl(var(--selection))",
          foreground: "hsl(var(--selection-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        offer: {
          DEFAULT: "hsl(var(--offer))",
          foreground: "hsl(var(--offer-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          foreground: "hsl(var(--danger-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        inventory: {
          available: "hsl(var(--inventory-available))",
          low: "hsl(var(--inventory-low))",
          unavailable: "hsl(var(--inventory-unavailable))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        focus: "hsl(var(--focus))",
        ring: "hsl(var(--ring))",
        overlay: "hsl(var(--overlay) / <alpha-value>)",

        // Legacy migration aliases. Do not use these in new or normalized code.
        accent2: {
          DEFAULT: "hsl(var(--accent-2))",
          foreground: "hsl(var(--accent-2-foreground))",
        },
        accent3: {
          DEFAULT: "hsl(var(--accent-3))",
          foreground: "hsl(var(--accent-3-foreground))",
        },
        accent4: {
          DEFAULT: "hsl(var(--accent-4))",
        },
        accent5: {
          DEFAULT: "hsl(var(--accent-5))",
        },
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
      },
      boxShadow: {
        surface: "var(--shadow-surface)",
        overlay: "var(--shadow-overlay)",
      },
      zIndex: {
        skipLink: "100",
      },
      minHeight: {
        storefrontTerminal: "70dvh",
      },
      transitionDuration: {
        fast: "var(--motion-fast)",
        standard: "var(--motion-standard)",
        slow: "var(--motion-slow)",
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        emphasized: "var(--ease-emphasized)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        scroll: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-25%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down var(--motion-fast) ease-out",
        "accordion-up": "accordion-up var(--motion-fast) ease-out",
        scroll: "scroll 14s linear infinite",
        pause: "none",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
