function __TS__ArrayPush<T>(this: void, arr: T[], items: T[]): number {
    let len = arr.length;
    for (const i of $range(1, items.length)) {
        len++;
        arr[len - 1] = items[i - 1];
    }
    return len;
}
