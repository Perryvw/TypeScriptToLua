function __TS__ArraySetLength<T>(this: void, arr: T[], length: number): number {
    if (
        length < 0 ||
        length !== length || // NaN
        length === Infinity || // Infinity
        Math.floor(length) !== length
    ) {
        // non-integer
        throw `invalid array length: ${length}`;
    }
    for (const i of $range(length + 1, arr.length)) {
        arr[i - 1] = undefined;
    }
    return length;
}
