import * as nativeAssert from "assert";
import * as path from "path";
import * as ts from "typescript";

export function castArray<T>(value: T | T[]): T[];
export function castArray<T>(value: T | readonly T[]): readonly T[];
export function castArray<T>(value: T | readonly T[]): readonly T[] {
    return Array.isArray(value) ? value : [value];
}

export const intersperse = <T>(values: readonly T[], separator: T): T[] =>
    values.flatMap((value, index) => (index === 0 ? [value] : [separator, value]));

export const union = <T>(...values: Array<Iterable<T>>): T[] => [...new Set(...values)];

export const intersection = <T>(first: readonly T[], ...rest: Array<readonly T[]>): T[] =>
    union(first).filter(x => rest.every(r => r.includes(x)));

export const invertObject = <K extends keyof any, V extends keyof any>(record: Record<K, V>): Record<V, K> =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [value, key]));

export function mapAndFind<T, U>(elements: T[], callback: (plugin: T) => U | undefined): U | undefined {
    for (const element of elements) {
        const result = callback(element);
        if (result !== undefined) {
            return result;
        }
    }
}

type DiagnosticFactory = (...args: any) => Partial<ts.Diagnostic> & Pick<ts.Diagnostic, "messageText">;
export const createDiagnosticFactoryWithCode = <T extends DiagnosticFactory>(code: number, create: T) =>
    Object.assign(
        (...args: Parameters<T>): ts.Diagnostic => ({
            file: undefined,
            start: undefined,
            length: undefined,
            category: ts.DiagnosticCategory.Error,
            code,
            source: "typescript-to-lua",
            ...create(...(args as any)),
        }),
        { code }
    );

let serialDiagnosticCodeCounter = 100000;
export const createSerialDiagnosticFactory = <T extends DiagnosticFactory>(create: T) =>
    createDiagnosticFactoryWithCode(serialDiagnosticCodeCounter++, create);

export const normalizeSlashes = (filePath: string) => filePath.replace(/\\/g, "/");
export const trimExtension = (filePath: string) => filePath.slice(0, -path.extname(filePath).length);

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

// eslint-disable-next-line @typescript-eslint/ban-types
export function isNonNull<T>(value: T | null | undefined): value is T {
    return value != null;
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

export function assert(value: any, message?: string | Error): asserts value {
    nativeAssert(value, message);
}

export function assertNever(_value: never): never {
    throw new Error("Value is expected to be never");
}

export function assume<T>(_value: any): asserts _value is T {}
