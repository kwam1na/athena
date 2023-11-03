export class ServiceError extends Error {
    details?: any;
    status: number;
    constructor(message: string, status: number, details?: any,) {
        super(message);
        this.details = details;
        this.status = status;
    }
}