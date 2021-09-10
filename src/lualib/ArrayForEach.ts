function __TS__ArrayForEach<T>(
    this: void,
    arr: T[],
    callbackFn: (value: T, index?: number, array?: any[]) => any,
    thisArg?: any
): void {
    for (const i of $range(1, arr.length)) {
        callbackFn.call(thisArg, arr[i - 1], i - 1, arr);
    }
}
