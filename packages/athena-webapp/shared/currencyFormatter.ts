const DISPLAY_CURRENCY_SYMBOLS: Record<string, string> = {
  GHS: "GH₵",
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

export function currencyFormatter(currency: string): Intl.NumberFormat {
  const normalizedCurrency = currency.toUpperCase();
  const displaySymbol = DISPLAY_CURRENCY_SYMBOLS[normalizedCurrency];

  if (displaySymbol) {
    const numberFormatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    const formatter = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
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
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
