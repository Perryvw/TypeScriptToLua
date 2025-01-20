const symbolMetatable = {
    __tostring(this: symbol): string {
        return `Symbol(${this.description ?? ""})`;
    },
};

export function __TS__Symbol(this: void, description?: string | number): symbol {
    return setmetatable({ description }, symbolMetatable) as unknown as symbol;
}

export const Symbol = {
    asyncDispose: __TS__Symbol("Symbol.asyncDispose"),
    dispose: __TS__Symbol("Symbol.dispose"),
    iterator: __TS__Symbol("Symbol.iterator"),
    asyncIterator: __TS__Symbol("Symbol.asyncIterator"),
    hasInstance: __TS__Symbol("Symbol.hasInstance"),

    // Not implemented
    species: __TS__Symbol("Symbol.species"),
    toStringTag: __TS__Symbol("Symbol.toStringTag"),
} as any;
