/** One detached editor owns a real Session reference until all admitted work settles. */
export interface SurfaceLifetime {
    readonly closing: boolean;
    readonly flights: number;
    readonly closed: Promise<void>;
    isAvailable(): boolean;
    withOperation<T>(operation: () => T | Promise<T>): Promise<T>;
    whenSettled(): Promise<void>;
    dispose(): void;
}
export declare function createSurfaceLifetime(callbacks: {
    close(): void;
    release(): void;
    changed?(closing: boolean, flights: number): void;
}): SurfaceLifetime;
