import * as util from "../../util";

test("omitted expression", () => {
    util.testFunction`
        const array = [1, , 2];
        return { a: array[0], b: array[1], c: array[2] };
    `.expectToMatchJsResult();
});

describe("access", () => {
    test("Array", () => {
        util.testFunction`
            const array: Array<number> = [3, 5, 1];
            return array[1];
        `.expectToMatchJsResult();
    });

    test("ReadonlyArray", () => {
        util.testFunction`
            const array: ReadonlyArray<number> = [3, 5, 1];
            return array[1];
        `.expectToMatchJsResult();
    });

    test("array literal", () => {
        util.testExpression`[3, 5, 1][1]`.expectToMatchJsResult();
    });

    test("const array literal", () => {
        util.testExpression`([3, 5, 1] as const)[1]`.expectToMatchJsResult();
    });

    test("tuple", () => {
        util.testFunction`
            const tuple: [number, number, number] = [3, 5, 1];
            return tuple[1];
        `.expectToMatchJsResult();
    });

    test("readonly tuple", () => {
        util.testFunction`
            const tuple: readonly [number, number, number] = [3, 5, 1];
            return tuple[1];
        `.expectToMatchJsResult();
    });

    test("union", () => {
        util.testFunction`
            const array: number[] | string[] = [3, 5, 1];
            return array[1];
        `.expectToMatchJsResult();
    });

    test("union with empty tuple", () => {
        util.testFunction`
            const array: number[] | [] = [3, 5, 1];
            return array[1];
        `.expectToMatchJsResult();
    });

    test("union with tuple", () => {
        util.testFunction`
            const tuple: number[] | [number, number, number] = [3, 5, 1];
            return tuple[1];
        `.expectToMatchJsResult();
    });

    test("access in call", () => {
        util.testExpression`[() => "foo", () => "bar"][0]()`.expectToMatchJsResult();
    });

    test("intersection", () => {
        util.testFunction`
            const array = Object.assign([3, 5, 1], { foo: "bar" });
            return { foo: array.foo, a: array[0], b: array[1], c: array[2] };
        `.expectToMatchJsResult();
    });

    test("with enum value index", () => {
        util.testFunction`
            enum TestEnum {
                A,
                B,
                C,
            }

            const array = ["a", "b", "c"];
            let index = TestEnum.A;
            return array[index];
        `.expectToMatchJsResult();
    });

    test.each([
        { member: "firstElement()", expected: 3 },
        { member: "name", expected: "array" },
        { member: "length", expected: 1 },
    ])("derived array (.%p)", ({ member, expected }) => {
        const luaHeader = `
            local array = {
                name = "array",
                firstElement = function(self) return self[1] end
            }
        `;

        util.testModule`
            interface CustomArray<T> extends Array<T> {
                name: string;
                firstElement(): number;
            };

            declare const array: CustomArray<number>;

            array[0] = 3;
            export const result = array.${member};
        `
            .setReturnExport("result")
            .setLuaHeader(luaHeader)
            .expectToEqual(expected);
    });
});

describe("array.length", () => {
    describe("get", () => {
        test("union", () => {
            util.testFunction`
                const array: number[] | string[] = [3, 5, 1];
                return array.length;
            `.expectToMatchJsResult();
        });

        test("intersection", () => {
            util.testFunction`
                const array = Object.assign([3, 5, 1], { foo: "bar" });
                return array.length;
            `.expectToMatchJsResult();
        });

        test("tuple", () => {
            util.testFunction`
                const tuple: [number, number, number] = [3, 5, 1];
                return tuple.length;
            `.expectToMatchJsResult();
        });
    });

    describe("set", () => {
        test.each([
            { length: 0, newLength: 0 },
            { length: 1, newLength: 1 },
            { length: 7, newLength: 3 },
        ])("removes extra elements", ({ length, newLength }) => {
            util.testFunction`
                const array = [1, 2, 3];
                array.length = ${length};
                return array.length;
            `.expectToEqual(newLength);
        });

        test.each([0, 1, 7])("returns right-hand side value", length => {
            util.testExpression`[1, 2, 3].length = ${length}`.expectToEqual(length);
        });

        test.each([-1, -7, 0.1])("throws on invalid values (%p)", length => {
            util.testFunction`
                [1, 2, 3].length = ${length};
            `.expectToEqual(new util.ExecutionError(`invalid array length: ${length}`));
        });

        test.each([NaN, Infinity, -Infinity])("throws on invalid special values (%p)", length => {
            // Need to get the actual lua tostring version of inf/nan
            // this is platform dependent so we can/should not hardcode it
            const luaSpecialValueString = util.testExpression`(${length}).toString()`.getLuaExecutionResult();
            util.testFunction`
                [1, 2, 3].length = ${length};
            `.expectToEqual(new util.ExecutionError(`invalid array length: ${luaSpecialValueString}`));
        });

        test("in array destructuring", () => {
            util.testFunction`
                const array = [0, 1, 2];
                [array.length] = [0];
                return array.length;
            `.expectToEqual(0);
        });

        test("in nested array destructuring", () => {
            util.testFunction`
                const array = [0, 1, 2];
                [[array.length]] = [[0]];
                return array.length;
            `.expectToEqual(0);
        });

        test("in object destructuring", () => {
            util.testFunction`
                const array = [0, 1, 2];
                ({ length: array.length } = { length: 0 });
                return array.length;
            `.expectToEqual(0);
        });

        test("in nested object destructuring", () => {
            util.testFunction`
                const array = [0, 1, 2];
                ({ obj: { length: array.length } } = { obj: { length: 0 } });
                return array.length;
            `.expectToEqual(0);
        });
    });
});

describe("delete", () => {
    test("deletes element", () => {
        util.testFunction`
            const array = [1, 2, 3, 4];
            delete array[2];
            return { a: array[0], b: array[1], c: array[2], d: array[3] };
        `.expectToMatchJsResult();
    });

    test("returns true when deletion attempt was allowed", () => {
        util.testFunction`
            const array = [1, 2, 3, 4];
            const success = delete array[2];
            return { success, a: array[0], b: array[1], c: array[2], d: array[3] };
        `.expectToMatchJsResult();
    });

    test("returns false when deletion attempt was disallowed", () => {
        util.testFunction`
            const array = [1, 2, 3, 4];
            Object.defineProperty(array, 2, { configurable: false });

            let success;
            try {
                success = delete array[2];
            } catch {
                success = "error";
            }

            return { success, a: array[0], b: array[1], c: array[2], d: array[3] };
        `.expectToMatchJsResult();
    });
});

test("tuple.forEach", () => {
    util.testFunction`
        const tuple: [number, number, number] = [3, 5, 1];
        let count = 0;
        tuple.forEach(value => {
            count += value;
        });
        return count;
    `.expectToMatchJsResult();
});

test("array.forEach (%p)", () => {
    util.testFunction`
        const array = [0, 1, 2, 3];
        array.forEach((elem, index) => {
            array[index] = array[index] + 1;
        });
        return array;
    `.expectToMatchJsResult();
});

test.each([
    { array: [], predicate: "elem > 3" },
    { array: [0, 2, 4, 8], predicate: "elem > 10" },
    { array: [0, 2, 4, 8], predicate: "elem > 7" },
    { array: [0, 2, 4, 8], predicate: "elem == 0" },
    { array: [0, 2, 4, 8], predicate: "elem > 7" },
    { array: [0, 2, 4, 8], predicate: "true" },
    { array: [0, 2, 4, 8], predicate: "false" },
])("array.find (%p)", ({ array, predicate }) => {
    util.testFunction`
        const array = ${util.formatCode(array)};
        return array.find((elem, index, arr) => ${predicate} && arr[index] === elem);
    `.expectToMatchJsResult();
});

test.each([
    { array: [], searchElement: 3 },
    { array: [0, 2, 4, 8], searchElement: 10 },
    { array: [0, 2, 4, 8], searchElement: 0 },
    { array: [0, 2, 4, 8], searchElement: 8 },
])("array.findIndex (%p)", ({ array, searchElement }) => {
    util.testFunction`
        const array = ${util.formatCode(array)};
        return array.findIndex((elem, index, arr) => elem === ${searchElement} && arr[index] === elem);
    `.expectToMatchJsResult();
});

test.each([
    { array: [], func: "x => x" },
    { array: [0, 1, 2, 3], func: "x => x" },
    { array: [0, 1, 2, 3], func: "x => x*2" },
    { array: [1, 2, 3, 4], func: "x => -x" },
    { array: [0, 1, 2, 3], func: "x => x+2" },
    { array: [0, 1, 2, 3], func: "x => x%2 == 0 ? x + 1 : x - 1" },
])("array.map (%p)", ({ array, func }) => {
    util.testExpression`${util.formatCode(array)}.map(${func})`.expectToMatchJsResult();
});

test.each([
    { array: [], func: "x => x > 1" },
    { array: [0, 1, 2, 3], func: "x => x > 1" },
    { array: [0, 1, 2, 3], func: "x => x < 3" },
    { array: [0, 1, 2, 3], func: "x => x < 0" },
    { array: [0, -1, -2, -3], func: "x => x < 0" },
    { array: [0, 1, 2, 3], func: "() => true" },
    { array: [0, 1, 2, 3], func: "() => false" },
])("array.filter (%p)", ({ array, func }) => {
    util.testExpression`${util.formatCode(array)}.filter(${func})`.expectToMatchJsResult();
});

test.each([
    { array: [], func: "x => x > 1" },
    { array: [0, 1, 2, 3], func: "x => x > 1" },
    { array: [false, true, false], func: "x => x" },
    { array: [true, true, true], func: "x => x" },
])("array.every (%p)", ({ array, func }) => {
    util.testExpression`${util.formatCode(array)}.every(${func})`.expectToMatchJsResult();
});

test.each([
    { array: [], func: "x => x > 1" },
    { array: [0, 1, 2, 3], func: "x => x > 1" },
    { array: [false, true, false], func: "x => x" },
    { array: [true, true, true], func: "x => x" },
])("array.some (%p)", ({ array, func }) => {
    util.testExpression`${util.formatCode(array)}.some(${func})`.expectToMatchJsResult();
});

test.each([
    { array: [2, 3, 4, 5], args: [] },
    { array: [], args: [1, 2] },
    { array: [0, 1, 2, 3], args: [1, 2] },
    { array: [0, 1, 2, 3], args: [1, 1] },
    { array: [0, 1, 2, 3], args: [1, -1] },
    { array: [0, 1, 2, 3], args: [-3, -1] },
    { array: [0, 1, 2, 3, 4, 5], args: [1, 3] },
    { array: [0, 1, 2, 3, 4, 5], args: [3] },
])("array.slice (%p)", ({ array, args }) => {
    const argumentString = util.formatCode(...args);
    util.testExpression`${util.formatCode(array)}.slice(${argumentString})`.expectToMatchJsResult();
});

test.each([
    // Insert
    { array: [], start: 0, deleteCount: 0, newElements: [9, 10, 11] },
    { array: [0, 1, 2, 3], start: 1, deleteCount: 0, newElements: [9, 10, 11] },
    { array: [0, 1, 2, 3], start: 2, deleteCount: 2, newElements: [9, 10, 11] },
    { array: [0, 1, 2, 3], start: 4, deleteCount: 1, newElements: [8, 9] },
    { array: [0, 1, 2, 3], start: 4, deleteCount: 0, newElements: [8, 9] },
    { array: [0, 1, 2, 3], start: -2, deleteCount: 0, newElements: [8, 9] },
    { array: [0, 1, 2, 3], start: -3, deleteCount: 0, newElements: [8, 9] },
    { array: [0, 1, 2, 3, 4, 5], start: 5, deleteCount: 9, newElements: [10, 11] },
    { array: [0, 1, 2, 3, 4, 5], start: 3, deleteCount: 2, newElements: [3, 4, 5] },
    { array: [0, 1, 2, 3, 4, 5, 6, 7, 8], start: 5, deleteCount: 9, newElements: [10, 11] },
    { array: [0, 1, 2, 3, 4, 5, 6, 7, 8], start: 5, deleteCount: undefined, newElements: [10, 11] },
    { array: [0, 1, 2, 3, 4, 5, 6, 7, 8], start: 5, deleteCount: null, newElements: [10, 11] },

    // Remove
    { array: [], start: 1, deleteCount: 1 },
    { array: [0, 1, 2, 3], start: 1, deleteCount: 1 },
    { array: [0, 1, 2, 3], start: 10, deleteCount: 1 },
    { array: [0, 1, 2, 3, 4, 5], start: 2, deleteCount: 2 },
    { array: [0, 1, 2, 3, 4, 5], start: -3, deleteCount: 2 },
    { array: [0, 1, 2, 3], start: 1, deleteCount: undefined },
    { array: [0, 1, 2, 3], start: 1, deleteCount: null },
])("array.splice (%p)", ({ array, start, deleteCount, newElements = [] }) => {
    util.testFunction`
        const array = ${util.formatCode(array)};
        array.splice(${util.formatCode(start, deleteCount, ...newElements)});
        return array;
    `.expectToMatchJsResult();
});

test.each([
    { array: [0, 1, 2, 3], start: 4 },
    { array: [0, 1, 2, 3, 4, 5], start: 3 },
    { array: [0, 1, 2, 3, 4, 5], start: -3 },
    { array: [0, 1, 2, 3, 4, 5], start: -2 },
])("array.splice no delete argument", ({ array, start }) => {
    util.testExpression`${util.formatCode(array)}.splice(${start})`.expectToMatchJsResult();
});

test.each([
    { array: [], args: [[]] },
    { array: [1, 2, 3], args: [[]] },
    { array: [1, 2, 3], args: [[4]] },
    { array: [1, 2, 3], args: [[4, 5]] },
    { array: [1, 2, 3], args: [[4, 5]] },
    { array: [1, 2, 3], args: [4, [5]] },
    { array: [1, 2, 3], args: [4, [5, 6]] },
    { array: [1, 2, 3], args: [4, [5, 6], 7] },
    { array: [1, 2, 3], args: ["test", [5, 6], 7, ["test1", "test2"]] },
    { array: [1, 2, "test"], args: ["test", ["test1", "test2"]] },
])("array.concat (%p)", ({ array, args }) => {
    util.testFunction`
        const array: any[] = ${util.formatCode(array)};
        return array.concat(${util.formatCode(...args)});
    `.expectToMatchJsResult();
});

test.each([
    { array: [1, 2, 3], includes: 2 },
    { array: [1, 2, 3, 2, 2], includes: 2 },
    { array: [1, 2, 3], includes: 4 },
    { array: ["a", "b", "c"], includes: "d" },
    { array: [[1], [2], [3]], includes: [2] },
    { array: [1, [2], 3], includes: 2 },
])("array.includes (%p)", ({ array, includes }) => {
    util.testExpressionTemplate`${array}.includes(${includes})`.expectToMatchJsResult();
});

test("array.includes reference", () => {
    util.testFunction`
        const inst = [2];
        return [[1], [3], inst].includes(inst);
    `.expectToMatchJsResult();
});

test.each([
    { array: [1, 2, 3], includes: 2, fromIndex: 0 },
    { array: [1, 2, 3], includes: 2, fromIndex: 1 },
    { array: [1, 2, 3], includes: 2, fromIndex: 2 },
    { array: [1, 2, 3], includes: 2, fromIndex: 3 },
    { array: [1, 2, 3], includes: 2, fromIndex: -1 },
    { array: [1, 2, 3], includes: 2, fromIndex: -2 },
    { array: [1, 2, 3], includes: 2, fromIndex: -3 },
    { array: [1, 2, 3], includes: 2, fromIndex: -4 },
])("array.includes with fromIndex (%p)", ({ array, includes, fromIndex }) => {
    util.testExpressionTemplate`${array}.includes(${includes}, ${fromIndex})`.expectToMatchJsResult();
});

test.each([
    { array: [] },
    { array: ["test1"] },
    { array: ["test1", "test2"] },
    { array: ["test1", "test2"], separator: ";" },
    { array: ["test1", "test2"], separator: "" },
    { array: [1, "2"] },
])("array.join (%p)", ({ array, separator }) => {
    util.testExpression`${util.formatCode(array)}.join(${util.formatCode(separator)})`.expectToMatchJsResult();
});

test('array.join (1, "2", {})', () => {
    const result = util.testExpression`[1, "2", {}].join()`.getLuaExecutionResult();
    expect(result).toMatch(/^1,2,table: 0x[\da-f]+$/);
});

test('array.join (1, "2", Symbol("foo"))', () => {
    util.testExpression`[1, "2", Symbol("foo")].join(", ")`.expectToEqual("1, 2, Symbol(foo)");
});

test("array.join without separator argument", () => {
    util.testExpression`["test1", "test2"].join()`.expectToMatchJsResult();
});

test.each([
    { array: [], args: ["test1"] },
    { array: ["test1"], args: ["test1"] },
    { array: ["test1", "test2"], args: ["test2"] },
    { array: ["test1", "test2", "test3"], args: ["test3", 1] },
    { array: ["test1", "test2", "test3"], args: ["test1", 2] },
    { array: ["test1", "test2", "test3"], args: ["test1", -2] },
    { array: ["test1", "test2", "test3"], args: ["test1", 12] },
])("array.indexOf (%p)", ({ array, args }) => {
    util.testExpression`${util.formatCode(array)}.indexOf(${util.formatCode(...args)})`.expectToMatchJsResult();
});

test.each([{ args: "1" }, { args: "1, 2, 3" }, { args: "...[1, 2, 3]" }])("array.push (%p)", ({ args }) => {
    util.testFunction`
        const array = [0];
        const value = array.push(${args});
        return { array, value };
    `.expectToMatchJsResult();
});
test("array.push (optimized vararg)", () => {
    util.testModule`
         function pushAll(...args: any[]) {
            const array = [0];
            const value = array.push(...args);
            return { array, value };
         }
         export const result = pushAll(1, 2, 3)
    `
        .setReturnExport("result")
        .expectToMatchJsResult();
});

test.each([
    { array: [1, 2, 3], expected: [3, 2] },
    { array: [1, 2, 3, null], expected: [3, 2] },
])("array.pop (%p)", ({ array, expected }) => {
    util.testFunction`
        const array = ${util.formatCode(array)};
        const value = array.pop();
        return [value, array.length];
    `.expectToEqual(expected);
});

test.each([{ array: [1, 2, 3] }, { array: [1, 2, 3, 4] }, { array: [1] }, { array: [] }])(
    "array.reverse (%p)",
    ({ array }) => {
        util.testFunction`
            const array = ${util.formatCode(array)};
            array.reverse();
            return array;
        `.expectToMatchJsResult();
    }
);

test.each([{ array: [1, 2, 3] }, { array: [1] }, { array: [] }])("array.shift (%p)", ({ array }) => {
    util.testFunction`
        const array = ${util.formatCode(array)};
        const value = array.shift();
        return { array, value };
    `.expectToMatchJsResult();
});

test.each([
    { array: [3, 4, 5], args: [1, 2] },
    { array: [], args: [] },
    { array: [1], args: [] },
    { array: [], args: [1] },
])("array.unshift (%p)", ({ array, args }) => {
    util.testFunction`
        const array = ${util.formatCode(array)};
        const value = array.unshift(${util.formatCode(...args)});
        return { array, value };
    `.expectToMatchJsResult();
});

test.each([{ array: [4, 5, 3, 2, 1] }, { array: [1] }, { array: [] }])("array.sort (%p)", ({ array }) => {
    util.testFunctionTemplate`
        const array = ${array};
        array.sort();
        return array;
    `.expectToMatchJsResult();
});

test.each([
    { array: [1, 2, 3, 4, 5], compare: (a: number, b: number) => a - b },
    { array: ["4", "5", "3", "2", "1"], compare: (a: string, b: string) => Number(a) - Number(b) },
    { array: ["4", "5", "3", "2", "1"], compare: (a: string, b: string) => Number(b) - Number(a) },
])("array.sort with compare function (%p)", ({ array, compare }) => {
    util.testFunctionTemplate`
        const array = ${array};
        array.sort(${compare});
        return array;
    `.expectToMatchJsResult();
});

test.each([
    { array: [[]] },
    { array: [{ a: 1 }, { a: 2 }, { a: 3 }] },
    { array: [1, [2, 3], 4] },
    { array: [1, [2, 3], 4], depth: 0 },
    { array: [1, [[2], [3]], 4] },
    { array: [1, [[[2], [3]]], 4], depth: Infinity },
])("array.flat (%p)", ({ array, depth }) => {
    util.testExpressionTemplate`${array}.flat(${depth})`.expectToMatchJsResult();
});

test.each([
    { array: [[]], map: <T>(v: T) => v },
    { array: [1, 2, 3], map: (v: number) => ({ a: v * 2 }) },
    { array: [1, [2, 3], [4]], map: <T>(value: T) => value },
    { array: [1, 2, 3], map: (v: number) => v * 2 },
    { array: [1, 2, 3], map: (v: number) => [v, v * 2] },
    { array: [1, 2, 3], map: (v: number) => [v, [v]] },
    { array: [1, 2, 3], map: (v: number, i: number) => [v * 2 * i] },
])("array.flatMap (%p)", ({ array, map }) => {
    util.testExpressionTemplate`${array}.flatMap(${map})`.expectToMatchJsResult();
});

describe.each(["reduce", "reduceRight"])("array.%s", reduce => {
    test.each<[[(total: number, currentItem: number, index: number, array: number[]) => number, number?]]>([
        [[(total, currentItem) => total + currentItem]],
        [[(total, currentItem) => total * currentItem]],
        [[(total, currentItem) => total + currentItem, 10]],
        [[(total, currentItem) => total * currentItem, 10]],
        [[(total, _, index, array) => total + array[index]]],
        [[(a, b) => a + b]],
    ])("usage (%p)", args => {
        util.testExpression`[1, 3, 5, 7].${reduce}(${util.formatCode(...args)})`.expectToMatchJsResult();
    });

    test("empty undefined initial", () => {
        util.testExpression`[].${reduce}(() => {}, undefined)`.expectToMatchJsResult();
    });

    test("empty no initial", () => {
        util.testExpression`[].${reduce}(() => {})`.expectToMatchJsResult(true);
    });

    test("undefined returning callback", () => {
        util.testFunction`
            const calls: Array<{ a: void, b: string }> = [];
            ["a", "b"].${reduce}<void>((a, b) => { calls.push({ a, b }) }, undefined);
            return calls;
        `.expectToMatchJsResult();
    });
});

test.each([{ array: [] }, { array: ["a", "b", "c"] }, { array: [{ foo: "foo" }, { bar: "bar" }] }])(
    "array.entries (%p)",
    ({ array }) => {
        util.testFunction`
            const array = ${util.formatCode(array)};
            const result = [];
            for (const [i, v] of array.entries()) {
                result.push([i, v]);
            }
            return result;
        `.expectToMatchJsResult();
    }
);

test("array.entries indirect use", () => {
    util.testFunction`
        const entries = ["a", "b", "c"].entries();
        const result = [];
        for (const [i, v] of entries) {
            result.push([i, v]);
        }
        return result;
    `.expectToMatchJsResult();
});

test("array.entries destructured", () => {
    util.testExpression`[...["a", "b", "c"].entries()]`.expectToMatchJsResult();
});

const genericChecks = [
    "function generic<T extends number[]>(array: T)",
    "function generic<T extends [...number[]]>(array: T)",
    "type ArrayType = number[]; function generic<T extends ArrayType>(array: T)",
    "function generic<T extends number[]>(array: T & {})",
    "function generic<T extends number[] & {}>(array: T)",
];

test.each(genericChecks)("array constrained generic foreach (%p)", signature => {
    util.testFunction`
        ${signature}: number {
            let sum = 0;
            array.forEach(item => {
                if (typeof item === "number") {
                    sum += item;
                }
            });
            return sum;
        }
        return generic([1, 2, 3]);
    `.expectToMatchJsResult();
});

test.each(genericChecks)("array constrained generic length (%p)", signature => {
    util.testFunction`
        ${signature}: number {
            return array.length;
        }
        return generic([1, 2, 3]);
    `.expectToMatchJsResult();
});

test.each(["[]", '"hello"', "42", "[1, 2, 3]", '{ a: "foo", b: "bar" }'])(
    "Array.isArray matches JavaScript (%p)",
    valueString => {
        util.testExpression`Array.isArray(${valueString})`.expectToMatchJsResult();
    }
);

test("Array.isArray returns true for empty objects", () => {
    // Important edge case we cannot handle correctly due to [] and {}
    // being identical in Lua. We assume [] is more common than Array.isArray({}),
    // so it is more important to handle [] right, sacrificing the result for {}.
    // See discussion: https://github.com/TypeScriptToLua/TypeScriptToLua/pull/737
    util.testExpression`Array.isArray({})`.expectToEqual(true);
});

// Test fix for https://github.com/TypeScriptToLua/TypeScriptToLua/issues/738
test("array.prototype.concat issue #738", () => {
    util.testExpression`([] as any[]).concat(13, 323, {x: 3}, [2, 3])`.expectToMatchJsResult();
});
