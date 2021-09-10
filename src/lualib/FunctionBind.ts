function __TS__FunctionBind(
    this: void,
    fn: (this: void, ...argArray: any[]) => any,
    thisArg: any,
    ...boundArgs: any[]
): (...args: any[]) => any {
    return (...args: any[]) => {
        __TS__ArrayUnshift(args, boundArgs);
        return fn(thisArg, ...args);
    };
}
