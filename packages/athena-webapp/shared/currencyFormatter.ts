const DISPLAY_CURRENCY_SYMBOLS: Record<string, string> = {
  GHS: "GH₵",
};

type CurrencyFormatterOptions = {
  maximumFractionDigits?: number;
  minimumFractionDigits?: number;
};

export function currencyDisplaySymbol(currency: string): string {
  const normalizedCurrency = currency.toUpperCase();
  const displaySymbol = DISPLAY_CURRENCY_SYMBOLS[normalizedCurrency];

  if (displaySymbol) {
    return displaySymbol;
  }

  const currencyPart = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
    .formatToParts(0)
    .find((part) => part.type === "currency");

  return currencyPart?.value ?? normalizedCurrency;
}

export function currencyFormatter(
  currency: string,
  options: CurrencyFormatterOptions = {},
): Intl.NumberFormat {
  const normalizedCurrency = currency.toUpperCase();
  const displaySymbol = DISPLAY_CURRENCY_SYMBOLS[normalizedCurrency];
  const minimumFractionDigits = options.minimumFractionDigits ?? 0;
  const maximumFractionDigits = options.maximumFractionDigits ?? 0;

  if (displaySymbol) {
    const numberFormatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits,
      maximumFractionDigits,
    });
    const formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits,
      maximumFractionDigits,
    });

    Object.defineProperty(formatter, "format", {
      value(amount: number) {
        return `${displaySymbol}${numberFormatter.format(amount)}`;
      },
    });

    return formatter;
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  });
}
