function __TS__ArrayConcat(this: void, arr: any[], items: any[]): any[] {
    const result: any[] = [];
    let len = 0;
    for (const i of $range(1, arr.length)) {
        len++;
        result[len - 1] = arr[i - 1];
    }
    for (const i of $range(1, items.length)) {
        const item = items[i - 1];
        if (Array.isArray(item)) {
            for (const j of $range(1, item.length)) {
                len++;
                result[len - 1] = item[j - 1];
            }
        } else {
            len++;
            result[len - 1] = item;
        }
    }

    return result;
}
