import { cannotAssignToNodeOfKind, invalidMultiReturnAccess } from "../../src/transformation/utils/diagnostics";
import * as util from "../util";

const allBindings = "x, y, z, rest";
const testCases = [
    { binding: "{ x }", value: { x: true } },
    { binding: "{ x, y }", value: { x: false, y: true } },
    { binding: "{ x: z, y }", value: { x: true, y: false } },
    { binding: "{ x: { x, y }, z }", value: { x: { x: true, y: false }, z: false } },
    { binding: "{ x, y = true }", value: { x: false, y: false } },
    { binding: "{ x = true }", value: {} },
    { binding: "{ x, y = true }", value: { x: false } },
    { binding: "{ ...rest }", value: {} },
    { binding: "{ x, ...rest }", value: { x: "x" } },
    { binding: "{ x, ...rest }", value: { x: "x", y: "y", z: "z" } },
    { binding: "{ x, ...y }", value: { x: "x", y: "y", z: "z" } },
    { binding: "{ x: y, ...z }", value: { x: "x", y: "y", z: "z" } },

    { binding: "[]", value: [] },
    { binding: "[x, y]", value: ["x", "y"] },
    { binding: "[x, , y]", value: ["x", "", "y"] },
    { binding: "[x = true]", value: [false] },
    { binding: "[[x, y]]", value: [["x", "y"]] },
    { binding: "[x, ...rest]", value: ["x"] },
    { binding: "[x, ...rest]", value: ["x", "y", "z"] },

    { binding: "{ y: [z = true] }", value: { y: [false] } },
    { binding: "{ x: [x, y] }", value: { x: ["x", "y"] } },
    { binding: "{ x: [{ y }] }", value: { x: [{ y: "y" }] } },
].map(({ binding, value }) => ({ binding, value: util.formatCode(value) }));

test.each([
    ...testCases,
    { binding: "{ x, y }, z", value: "{ x: false, y: false }, true" },
    { binding: "{ x, y }, { z }", value: "{ x: false, y: false }, { z: true }" },
])("in function parameter (%p)", ({ binding, value }) => {
    util.testFunction`
        let ${allBindings};
        function test(${binding}) {
            return { ${allBindings} };
        }

        return test(${value});
    `.expectToMatchJsResult();
});

test("in function parameter creates local variables", () => {
    const builder = util.testModule`
        function test({ a, b }: any) {}
    `;

    const code = builder.getMainLuaCodeChunk();
    expect(code).toContain("local a =");
    expect(code).toContain("local b =");
});

test("in function parameter creates local variables in correct scope", () => {
    util.testFunction`
        let x = 7;
        function foo([x]: [number]) {
            x *= 2;
        }
        foo([1]);
        return x;
    `.expectToMatchJsResult();
});

test.each(testCases)("in variable declaration (%p)", ({ binding, value }) => {
    util.testFunction`
        let ${allBindings};
        {
            const ${binding} = ${value};
            return { ${allBindings} };
        }
    `.expectToMatchJsResult();
});

test.each(testCases)("in variable declaration from const variable (%p)", ({ binding, value }) => {
    util.testFunction`
        let ${allBindings};
        {
            const v: any = ${value};
            const ${binding} = v;
            return { ${allBindings} };
        }
   `.expectToMatchJsResult();
});

test.each(testCases)("in variable declaration from this (%p)", ({ binding, value }) => {
    util.testFunction`
        let ${allBindings};
        function test(this: any) {
            const ${binding} = this;
            return { ${allBindings} };
        }
        return test.call(${value});
    `.expectToMatchJsResult();
});

test.each(testCases)("in exported variable declaration (%p)", ({ binding, value }) => {
    util.testModule`
        export const ${binding} = ${value};
    `.expectToMatchJsResult();
});

const assignmentTestCases = [
    ...testCases,
    ...[
        { binding: "{ x: obj.prop }", value: { x: true } },
        { binding: "{ x: obj.prop = true }", value: {} },
        { binding: "[{ x: obj.prop }]", value: [{ x: true }] },
        { binding: "{ obj: { prop: obj.prop } }", value: { obj: { prop: true } } },
        { binding: "{ x = true }", value: {} },
    ].map(({ binding, value }) => ({ binding, value: util.formatCode(value) })),
    { binding: "{ x: { [(3).toString()]: y } }", value: "{ x: { [(3).toString()]: true } }" },
];

test.each(assignmentTestCases)("in assignment expression (%p)", ({ binding, value }) => {
    util.testFunction`
        let ${allBindings};
        const obj = { prop: false };
        const expressionResult = (${binding} = ${value});
        return { ${allBindings}, obj, expressionResult };
    `.expectToMatchJsResult();
});

test.each(assignmentTestCases)("in assignment expression from const variable (%p)", ({ binding, value }) => {
    util.testFunction`
        let ${allBindings};
        const obj = { prop: false };
        const v: any = ${value};
        const expressionResult = (${binding} = v);
        return { ${allBindings}, expressionResult };
    `.expectToMatchJsResult();
});

test.each(assignmentTestCases)("in assignment expression from this (%p)", ({ binding, value }) => {
    util.testFunction`
        let ${allBindings};
        const obj = { prop: false };
        function test(this: any) {
            const expressionResult = (${binding} = this);
            return { ${allBindings}, obj, expressionResult };
        }
        return test.call(${value});
    `.expectToMatchJsResult();
});

test.each(["[]", "{}"])("empty binding pattern", bindingPattern => {
    util.testFunction`
        let i = 1;
        const ${bindingPattern} = [i++];
        return i;
    `.expectToMatchJsResult();
});

// TODO: https://github.com/microsoft/TypeScript/pull/35906
// Adjust this test to use expectToMatchJsResult() and testCases when this issue is fixed.
test.each([
    ["foo", "['bar']"],
    ["[foo]", "[['bar']]"],
    ["[foo = 'bar']", "[[]]"],
    ["{ foo }", "[{ foo: 'bar' }]"],
    ["{ x: foo }", "[{ x: 'bar' }]"],
    ["{ foo = 'bar' }", "[{}] as { foo?: string }[]"],
])("forof assignment updates dependencies", (initializer, expression) => {
    util.testModule`
        let foo = '';
        export { foo };
        for (${initializer} of ${expression}) {}
    `
        .setReturnExport("foo")
        .expectToEqual("bar");
});

test.each(testCases)("forof variable declaration binding patterns (%p)", ({ binding, value }) => {
    util.testFunction`
        let ${allBindings};
        for (const ${binding} of [${value} as any]) {
            return { ${allBindings} };
        }
    `.expectToMatchJsResult();
});

describe("array destructuring optimization", () => {
    // TODO: Try to generalize optimization logic between declaration and assignment and make more generic tests

    test("array", () => {
        util.testFunction`
            const array = [3, 5, 1];
            const [a, b, c] = array;
            return { a, b, c };
        `
            .tap(builder => expect(builder.getMainLuaCodeChunk()).toContain("unpack"))
            .expectToMatchJsResult();
    });

    test("array literal", () => {
        util.testFunction`
            const [a, b, c] = [3, 5, 1];
            return { a, b, c };
        `
            .tap(builder => expect(builder.getMainLuaCodeChunk()).not.toContain("unpack"))
            .expectToMatchJsResult();
    });

    test("array literal with extra values", () => {
        util.testFunction`
            let called = false;
            const set = () => { called = true; };
            const [head] = ["foo", set()];
            return { head, called };
        `
            .tap(builder => expect(builder.getMainLuaCodeChunk()).not.toContain("unpack"))
            .expectToMatchJsResult();
    });

    test("array union", () => {
        util.testFunction`
            const array: [string] | [] = ["bar"];
            let x: string;
            [x] = array;
            return x;
        `
            .tap(builder => expect(builder.getMainLuaCodeChunk()).toContain("unpack"))
            .expectToMatchJsResult();
    });
});

test("no exception from semantically invalid TS", () => {
    util.testModule`
        declare function testFunc(value: number): LuaMultiReturn<[number, number]>;
        let [a, b] = testFunc(5) // Missing ;
        [a, b] = testFunc(b)     // Interpreted as testFunc(5)[a, b]
    `
        .withLanguageExtensions()
        .disableSemanticCheck()
        .expectToHaveDiagnostics([invalidMultiReturnAccess.code, cannotAssignToNodeOfKind.code]);
});

describe("string destructuring", () => {
    test("string literal declaration", () => {
        util.testFunction`
            const [a, b, c] = "test";
            return { a, b, c };
        `.expectToMatchJsResult();
    });

    test("string literal assignment", () => {
        util.testFunction`
            let a = "";
            let b = "";
            let c = "";
            [a, b, c] = "test";
            return { a, b, c };
        `
            .debug()
            .expectToMatchJsResult();
    });

    test("string assignment", () => {
        util.testFunction`
            const foo = "test";
            const [a, b, c] = foo;
            return { a, b, c };
        `.expectToMatchJsResult();
    });

    // not wokring right now: send help pls
    test("for loop init", () => {
        util.testFunction`
            const foo = "test";
            for (const [a, b, c] of foo) {
                return { a, b, c };
            }
        `
            .debug()
            .expectToMatchJsResult();
    });
});
