export interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    child(namespace: string): Logger;
}
export declare function createLogger(namespace: string): Logger;
export declare const logger: Logger;
//# sourceMappingURL=index.d.ts.map