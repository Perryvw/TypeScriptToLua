function __TS__ArrayFlat(this: void, array: any[], depth = 1): any[] {
    const result: any[] = [];
    let len = 0;
    for (const i of $range(1, array.length)) {
        const value = array[i - 1];
        if (depth > 0 && Array.isArray(value)) {
            let toAdd: any[];
            if (depth === 1) {
                toAdd = value;
            } else {
                toAdd = value.flat(depth - 1);
            }
            for (const j of $range(1, toAdd.length)) {
                const val = toAdd[j - 1];
                len++;
                result[len - 1] = val;
            }
        } else {
            len++;
            result[len - 1] = value;
        }
    }

    return result;
}
