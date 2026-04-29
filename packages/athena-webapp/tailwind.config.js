/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: {
    relative: true,
    files: ["./src/**/*.{js,ts,jsx,tsx}"],
  },
  safelist: [
    "bg-green-100",
    "text-green-700",
    "bg-red-100",
    "text-red-700",
    "bg-amber-100",
    "text-amber-700",
    "bg-zinc-100",
    "text-zinc-700",
    "bg-gray-100",
    "text-gray-700",
    "bg-blue-100",
    "text-blue-700",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
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
        "control-standard": "var(--control-height-standard)",
        "control-compact": "var(--control-height-compact)",
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        surface: {
          DEFAULT: "hsl(var(--surface))",
          muted: "hsl(var(--surface-muted))",
          raised: "hsl(var(--surface-raised))",
        },
        shell: {
          DEFAULT: "hsl(var(--shell))",
          foreground: "hsl(var(--shell-foreground))",
        },
        signal: {
          DEFAULT: "hsl(var(--signal))",
          foreground: "hsl(var(--signal-foreground))",
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
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        chart: {
          1: "hsl(var(--chart-1))",
          2: "hsl(var(--chart-2))",
          3: "hsl(var(--chart-3))",
          4: "hsl(var(--chart-4))",
          5: "hsl(var(--chart-5))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      boxShadow: {
        surface: "var(--shadow-surface)",
        overlay: "var(--shadow-overlay)",
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
          from: {
            height: "0",
          },
          to: {
            height: "var(--radix-accordion-content-height)",
          },
        },
        "accordion-up": {
          from: {
            height: "var(--radix-accordion-content-height)",
          },
          to: {
            height: "0",
          },
        },
        "caret-blink": {
          "0%,70%,100%": {
            opacity: "1",
          },
          "20%,50%": {
            opacity: "0",
          },
        },
        "border-pulsate": {
          "0%, 100%": {
            borderColor: "hsl(var(--primary) / 0.3)",
            borderWidth: "1px",
          },
          "50%": {
            borderColor: "hsl(var(--primary) / 1)",
            borderWidth: "2.5px",
          },
        },
        "focus-sweep": {
          "0%": {
            transform: "translateX(-12%)",
            opacity: "0.42",
          },
          "100%": {
            transform: "translateX(112%)",
            opacity: "1",
          },
        },
        "presence-lift": {
          "0%": {
            opacity: "0",
            transform: "translateY(10px) scale(0.985)",
          },
          "100%": {
            opacity: "1",
            transform: "translateY(0) scale(1)",
          },
        },
        "status-breathe": {
          "0%, 100%": {
            opacity: "0.45",
            transform: "scaleX(0.92)",
          },
          "50%": {
            opacity: "1",
            transform: "scaleX(1)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "border-pulsate": "border-pulsate 2s ease-in-out infinite",
        "focus-sweep":
          "focus-sweep var(--motion-standard) var(--ease-emphasized) infinite",
        "presence-lift":
          "presence-lift var(--motion-standard) var(--ease-emphasized) infinite alternate",
        "status-breathe":
          "status-breathe var(--motion-slow) var(--ease-standard) infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
