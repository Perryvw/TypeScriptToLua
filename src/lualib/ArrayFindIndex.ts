function __TS__ArrayFindIndex<T>(
    this: void,
    arr: T[],
    callbackFn: (element: T, index?: number, array?: T[]) => boolean,
    thisArg?: any
): number {
    for (const i of $range(1, arr.length)) {
        if (callbackFn.call(thisArg, arr[i - 1], i - 1, arr)) {
            return i - 1;
        }
    }
    return -1;
}
