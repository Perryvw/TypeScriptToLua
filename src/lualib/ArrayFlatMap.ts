function __TS__ArrayFlatMap<T, U>(
    this: void,
    array: T[],
    callback: (value: T, index: number, array: T[]) => U | readonly U[],
    thisArg?: any
): U[] {
    const result: U[] = [];
    let len = 0;
    for (const i of $range(1, array.length)) {
        const value = callback.call(thisArg, array[i - 1], i - 1, array);
        if (Array.isArray(value)) {
            for (const j of $range(1, value.length)) {
                len++;
                result[len - 1] = value[j - 1];
            }
        } else {
            len++;
            result[len - 1] = value as U;
        }
    }

    return result;
}
