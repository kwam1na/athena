/**
 * Centralized logging utility for the application
 * Supports different log levels and environment-based filtering
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

class Logger {
  private isDevelopment: boolean;

  constructor() {
    this.isDevelopment =
      Boolean(import.meta.env.DEV) || import.meta.env.MODE === "development";
  }

  private shouldLog(level: LogLevel): boolean {
    // Always log errors and warnings
    if (level === "error" || level === "warn") {
      return true;
    }

    // Only log debug/info in development
    return this.isDevelopment;
  }

  private formatMessage(
    level: LogLevel,
    message: string,
    context?: LogContext
  ): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    if (context && Object.keys(context).length > 0) {
      return `${prefix} ${message}\nContext: ${JSON.stringify(context, null, 2)}`;
    }

    return `${prefix} ${message}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog("debug")) {
      console.debug(this.formatMessage("debug", message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog("info")) {
      console.info(this.formatMessage("info", message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, context));
    }
  }

  error(message: string, context?: LogContext | Error): void {
    if (this.shouldLog("error")) {
      const errorContext =
        context instanceof Error
          ? { error: context.message, stack: context.stack }
          : context;

      console.error(this.formatMessage("error", message, errorContext));
    }
  }
}

// Export singleton instance
export const logger = new Logger();

// Export type for convenience
export type { LogLevel, LogContext };
