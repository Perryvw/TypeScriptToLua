function __TS__ArrayFilter<T>(
    this: void,
    arr: T[],
    callbackfn: (value: T, index?: number, array?: any[]) => boolean,
    thisArg?: any
): T[] {
    const result: T[] = [];
    let len = 0;
    for (const i of $range(1, arr.length)) {
        if (callbackfn.call(thisArg, arr[i - 1], i - 1, arr)) {
            len++;
            result[len - 1] = arr[i - 1];
        }
    }
    return result;
}
