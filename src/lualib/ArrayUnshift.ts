function __TS__ArrayUnshift<T>(this: void, arr: T[], items: T[]): number {
    const length = items.length;
    if (length === 0) return arr.length;

    for (const i of $range(arr.length, 1, -1)) {
        arr[i + length - 1] = arr[i - 1];
    }
    for (const i of $range(1, length)) {
        arr[i - 1] = items[i - 1];
    }
    return arr.length;
}
