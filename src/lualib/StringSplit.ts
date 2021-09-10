function __TS__StringSplit(this: void, source: string, separator?: string, limit?: number): string[] {
    if (limit === undefined) {
        limit = 4294967295;
    }

    if (limit === 0) {
        return [];
    }

    const result = [];
    let resultIndex = 1;

    const sub = string.sub;
    if (separator === undefined || separator === "") {
        for (const i of $range(1, source.length)) {
            result[resultIndex - 1] = sub(source, i, i);
            resultIndex++;
        }
    } else {
        const find = string.find;
        let currentPos = 1;
        while (resultIndex <= limit) {
            const [startPos, endPos] = find(source, separator, currentPos, true);
            if (!startPos) break;
            result[resultIndex - 1] = sub(source, currentPos, startPos - 1);
            resultIndex++;
            currentPos = endPos + 1;
        }

        if (resultIndex <= limit) {
            result[resultIndex - 1] = sub(source, currentPos);
        }
    }

    return result;
}
