// https://www.ecma-international.org/ecma-262/9.0/index.html#sec-array.prototype.splice
function __TS__ArraySplice<T>(this: void, arr: T[], ...args: any[]): T[] {
    const len = arr.length;

    const actualArgumentCount = select("#", ...args);
    let start = args[0] as number;
    const deleteCount = args[1] as number;

    if (start < 0) {
        start = len + start;
        if (start < 0) {
            start = 0;
        }
    } else if (start > len) {
        start = len;
    }

    let itemCount = actualArgumentCount - 2;
    if (itemCount < 0) {
        itemCount = 0;
    }

    let actualDeleteCount: number;

    if (actualArgumentCount === 0) {
        // ECMA-spec line 5: if number of actual arguments is 0
        actualDeleteCount = 0;
    } else if (actualArgumentCount === 1) {
        // ECMA-spec line 6: if number of actual arguments is 1
        actualDeleteCount = len - start;
    } else {
        actualDeleteCount = deleteCount || 0;
        if (actualDeleteCount < 0) {
            actualDeleteCount = 0;
        }
        if (actualDeleteCount > len - start) {
            actualDeleteCount = len - start;
        }
    }

    const out: T[] = [];

    for (const k of $range(1, actualDeleteCount)) {
        const from = start + k;

        if (arr[from - 1] !== undefined) {
            out[k - 1] = arr[from - 1];
        }
    }

    if (itemCount < actualDeleteCount) {
        for (const k of $range(start + 1, len - actualDeleteCount)) {
            const from = k + actualDeleteCount;
            const to = k + itemCount;

            if (arr[from - 1]) {
                arr[to - 1] = arr[from - 1];
            } else {
                arr[to - 1] = undefined;
            }
        }
        for (const k of $range(len - actualDeleteCount + itemCount + 1, len)) {
            arr[k - 1] = undefined;
        }
    } else if (itemCount > actualDeleteCount) {
        for (const k of $range(len - actualDeleteCount, start + 1, -1)) {
            const from = k + actualDeleteCount;
            const to = k + itemCount;

            if (arr[from - 1]) {
                arr[to - 1] = arr[from - 1];
            } else {
                arr[to - 1] = undefined;
            }
        }
    }

    let j = start + 1;
    for (const i of $range(3, actualArgumentCount)) {
        arr[j - 1] = args[i - 1];
        j++;
    }

    for (const k of $range(arr.length, len - actualDeleteCount + itemCount + 1, -1)) {
        arr[k - 1] = undefined;
    }

    return out;
}
