export type MultiReturn<T extends any[]> = T & {
    readonly " __multiBrand": unique symbol;
};

declare function multi<T extends any[]>(...values: T): MultiReturn<T>;
