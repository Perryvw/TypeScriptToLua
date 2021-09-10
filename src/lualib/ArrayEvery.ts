function __TS__ArrayEvery<T>(
    this: void,
    arr: T[],
    callbackfn: (value: T, index?: number, array?: any[]) => boolean,
    thisArg?: any
): boolean {
    for (const i of $range(1, arr.length)) {
        if (!callbackfn.call(thisArg, arr[i - 1], i - 1, arr)) {
            return false;
        }
    }
    return true;
}
