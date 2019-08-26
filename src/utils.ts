export function flatMap<T, U>(array: readonly T[], callback: (value: T, index: number) => U | readonly U[]): U[] {
    const result: U[] = [];

    for (const [index, value] of array.entries()) {
        const mappedValue = callback(value, index);
        if (Array.isArray(mappedValue)) {
            result.push(...mappedValue);
        } else {
            result[result.length] = mappedValue as U;
        }
    }

    return result;
}

type NoInfer<T> = [T][T extends any ? 0 : never];

export function getOrUpdate<K, V>(
    map: Map<K, V> | (K extends object ? WeakMap<K, V> : never),
    key: K,
    getDefaultValue: () => NoInfer<V>
): V {
    if (!map.has(key)) {
        map.set(key, getDefaultValue());
    }

    return map.get(key)!;
}

export function isNonNull<T>(value: T | undefined | null): value is T {
    return value !== undefined && value !== null;
}

export function cast<TOriginal, TCast extends TOriginal>(
    item: TOriginal,
    cast: (item: TOriginal) => item is TCast
): TCast {
    if (cast(item)) {
        return item;
    } else {
        throw new Error(`Failed to cast value to expected type using ${cast.name}.`);
    }
}

export function castEach<TOriginal, TCast extends TOriginal>(
    items: TOriginal[],
    cast: (item: TOriginal) => item is TCast
): TCast[] {
    if (items.every(cast)) {
        return items as TCast[];
    } else {
        throw new Error(`Failed to cast all elements to expected type using ${cast.name}.`);
    }
}

export function assertNever(_value: never): never {
    throw new Error("Value is expected to be never");
}
