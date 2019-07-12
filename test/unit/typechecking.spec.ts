import * as util from "../util";

test.each(["0", "30", "30_000", "30.00"])("typeof number (%p)", inp => {
    util.testExpression`typeof ${inp}`.expectToMatchJsResult();
});

test.each(['"abc"', "`abc`"])("typeof string (%p)", inp => {
    util.testExpression`typeof ${inp}`.expectToMatchJsResult();
});

test.each(["false", "true"])("typeof boolean (%p)", inp => {
    util.testExpression`typeof ${inp}`.expectToMatchJsResult();
});

test.each(["{}", "[]"])("typeof object literal (%p)", inp => {
    util.testExpression`typeof ${inp}`.expectToMatchJsResult();
});

test("typeof class instance", () => {
    util.testFunction`
        class myClass {}
        let inst = new myClass();
        return typeof inst;
    `.expectToMatchJsResult();
});

test("typeof function", () => {
    util.testExpression`typeof (() => 3)`.expectToMatchJsResult();
});

test.each(["null", "undefined"])("typeof undefined (%p)", inp => {
    util.testExpression`typeof ${inp}`.expectToEqual("undefined");
});

test("instanceof", () => {
    util.testFunction`
        class myClass {}
        let inst = new myClass();
        return inst instanceof myClass;
    `.expectToMatchJsResult();
});

test("instanceof inheritance", () => {
    util.testFunction`
        class myClass {}
        class childClass extends myClass {}
        let inst = new childClass();
        return inst instanceof myClass;
    `.expectToMatchJsResult();
});

test("instanceof inheritance false", () => {
    util.testFunction`
        class myClass {}
        class childClass extends myClass {}
        let inst = new myClass();
        return inst instanceof childClass;
    `.expectToMatchJsResult();
});

test("{} instanceof Object", () => {
    util.testExpression`{} instanceof Object`.expectToMatchJsResult();
});

test("function instanceof Object", () => {
    util.testExpression`(() => {}) instanceof Object`.expectToMatchJsResult();
});

test("null instanceof Object", () => {
    util.testExpression`(null as any) instanceof Object`.expectToMatchJsResult();
});

test("instanceof undefined", () => {
    util.testExpression`{} instanceof (undefined as any)`.expectToMatchJsResult(true);
});

test("null instanceof Class", () => {
    util.testFunction`
        class myClass {}
        return (null as any) instanceof myClass;
    `.expectToMatchJsResult();
});

test("instanceof export", () => {
    util.testModule`
        export class myClass {}
        let inst = new myClass();
        export const result = inst instanceof myClass;
    `
        .setExport("result")
        .expectToMatchJsResult();
});

test("instanceof Symbol.hasInstance", () => {
    util.testFunction`
        class myClass {
            static [Symbol.hasInstance]() {
                return false;
            }
        }

        const inst = new myClass();
        const isInstanceOld = inst instanceof myClass;
        myClass[Symbol.hasInstance] = () => true;
        const isInstanceNew = inst instanceof myClass;
        return isInstanceOld !== isInstanceNew;
    `.expectToMatchJsResult();
});

test.each([
    { expression: "{}", operator: "===", compareTo: "object", expectResult: true },
    { expression: "{}", operator: "!==", compareTo: "object", expectResult: false },
    { expression: "{}", operator: "==", compareTo: "object", expectResult: true },
    { expression: "{}", operator: "!=", compareTo: "object", expectResult: false },
    { expression: "{}", operator: "<=", compareTo: "object", expectResult: true },
    { expression: "{}", operator: "<", compareTo: "object", expectResult: false },
    { expression: "undefined", operator: "===", compareTo: "undefined", expectResult: true },
    { expression: "() => {}", operator: "===", compareTo: "function", expectResult: true },
    { expression: "1", operator: "===", compareTo: "number", expectResult: true },
    { expression: "true", operator: "===", compareTo: "boolean", expectResult: true },
    { expression: `"foo"`, operator: "===", compareTo: "string", expectResult: true },
])("typeof literal comparison (%p)", ({ expression, operator, compareTo, expectResult }) => {
    const code = `
        let val = ${expression};
        return typeof val ${operator} "${compareTo}";`;

    expect(util.transpileString(code)).not.toMatch("__TS__TypeOf");
    expect(util.transpileAndExecute(code)).toBe(expectResult);
});

test.each([
    { expression: "{}", operator: "===", compareTo: "object", expectResult: true },
    { expression: "{}", operator: "!==", compareTo: "object", expectResult: false },
    { expression: "{}", operator: "==", compareTo: "object", expectResult: true },
    { expression: "{}", operator: "!=", compareTo: "object", expectResult: false },
    { expression: "{}", operator: "<=", compareTo: "object", expectResult: true },
    { expression: "{}", operator: "<", compareTo: "object", expectResult: false },
    { expression: "undefined", operator: "===", compareTo: "undefined", expectResult: true },
    { expression: "() => {}", operator: "===", compareTo: "function", expectResult: true },
    { expression: "1", operator: "===", compareTo: "number", expectResult: true },
    { expression: "true", operator: "===", compareTo: "boolean", expectResult: true },
    { expression: `"foo"`, operator: "===", compareTo: "string", expectResult: true },
])("typeof non-literal comparison (%p)", ({ expression, operator, compareTo, expectResult }) => {
    const code = `
        let val = ${expression};
        let compareTo = "${compareTo}";
        return typeof val ${operator} compareTo;`;

    expect(util.transpileString(code)).toMatch("__TS__TypeOf");
    expect(util.transpileAndExecute(code)).toBe(expectResult);
});
