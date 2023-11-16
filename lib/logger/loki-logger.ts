import { ILogger } from "../interfaces/logger";
import LokiTransport from "winston-loki";
import winston from "winston";

class WinstonLokiLogger implements ILogger {
    private logger: winston.Logger;

    constructor() {
        this.logger = winston.createLogger({
            level: 'info',
            transports: [
                new LokiTransport({
                    host: 'https://logs-prod-006.grafana.net',
                    json: true,
                    basicAuth: `${process.env.LOKI_USERNAME}:${process.env.LOKI_PASSWORD}`,
                    onConnectionError: (err) => console.error(err)
                }),
                new winston.transports.Console({}),
            ],
        });
    }

    warn(message: string, ...params: any[]): void {
        this.logger.warn(message, { params });
    }
    info(message: string, ...params: any[]): void {
        this.logger.info(message, { params })
    }
    debug(message: string, ...params: any[]): void {
        this.logger.debug(message, { params });
    }

    log(message: string, ...params: any[]): void {
        this.logger.log(message, { params });
    }

    error(message: string, ...params: any[]): void {
        this.logger.error(message, { params });
    }
}

const logger = new WinstonLokiLogger();
export default logger;