import { ILogger } from "../interfaces/logger";

class ConsoleLogger implements ILogger {
    log(message: string, ...params: any[]): void {
        console.log(message, ...params);
    }

    error(message: string, ...params: any[]): void {
        console.error(message, ...params);
    }

    warn(message: string, ...params: any[]): void {
        console.warn(message, ...params);
    }

    info(message: string, ...params: any[]): void {
        console.info(message, ...params);
    }

    debug(message: string, ...params: any[]): void {
        console.debug(message, ...params);
    }
}

const logger = new ConsoleLogger();
export default logger;