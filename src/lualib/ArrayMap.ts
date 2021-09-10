function __TS__ArrayMap<T, U>(
    this: void,
    arr: T[],
    callbackfn: (value: T, index?: number, array?: T[]) => U,
    thisArg?: any
): U[] {
    const result: U[] = [];
    for (const i of $range(1, arr.length)) {
        result[i - 1] = callbackfn.call(thisArg, arr[i - 1], i - 1, arr);
    }
    return result;
}
