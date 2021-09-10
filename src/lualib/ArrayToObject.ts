function __TS__ArrayToObject<T>(this: void, array: T[]): Record<number, T> {
    const object: Record<number, any> = {};
    for (const i of $range(1, array.length)) {
        object[i - 1] = array[i - 1];
    }
    return object;
}
