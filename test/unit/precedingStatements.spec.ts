import * as util from "../util";

test.each([
    { operator: "&&", testValue: true },
    { operator: "&&", testValue: false },
    { operator: "&&", testValue: null },
    { operator: "&&=", testValue: true },
    { operator: "&&=", testValue: false },
    { operator: "&&=", testValue: null },
    { operator: "||", testValue: true },
    { operator: "||", testValue: false },
    { operator: "||", testValue: null },
    { operator: "||=", testValue: true },
    { operator: "||=", testValue: false },
    { operator: "||=", testValue: null },
    { operator: "??", testValue: true },
    { operator: "??", testValue: false },
    { operator: "??", testValue: null },
    { operator: "??=", testValue: true },
    { operator: "??=", testValue: false },
    { operator: "??=", testValue: null },
])("short circuit operator (%p)", ({ operator, testValue }) => {
    util.testFunction`
        let x: unknown = ${testValue};
        let y = 1;
        const z = x ${operator} y++;
        return {x, y, z};
    `.expectToMatchJsResult();
});

test.each([true, false])("ternary operator (%p)", condition => {
    util.testFunction`
        let a = 0, b = 0;
        let condition: boolean = ${condition};
        const c = condition ? a++ : b++;
        return [a, b, c];
    `.expectToMatchJsResult();
});

describe("execution order", () => {
    const sequenceTests = [
        "i++, i",
        "i, i++, i, i++",
        "...a",
        "i, ...a",
        "...a, i",
        "i, ...a, i++, i, ...a",
        "i, ...a, i++, i, ...a, i",
        "...[1, i++, 2]",
        "...[1, i++, 2], i++",
        "i, ...[1, i++, 2]",
        "i, ...[1, i++, 2], i",
        "i, ...[1, i++, 2], i++",
        "i, ...[1, i++, 2], i++, ...[3, i++, 4]",
        "i, ...a, i++, ...[1, i++, 2], i, i++, ...a",
        "i, inc(), i++",
        "i, ...[1, i++, inc(), 2], i++",
        "[i, ...'foo', i++]",
        "[i, ...([1, i++, 2] as any), i++]",
    ];

    test.each(sequenceTests)("array literal ([%p])", sequence => {
        util.testFunction`
            const a = [7, 8, 9];
            let i = 0;
            function inc() { ++i; return i; }
            return [${sequence}];
        `.expectToMatchJsResult();
    });

    test.each(sequenceTests)("function arguments (foo(%p))", sequence => {
        util.testFunction`
            const a = [7, 8, 9];
            let i = 0;
            function inc() { ++i; return i; }
            function foo(...args: unknown[]) { return args; }
            return foo(${sequence});
        `.expectToMatchJsResult();
    });

    test.each([
        "{a: i, b: i++}",
        "{a: i, b: i++, c: i}",
        "{a: i, ...{b: i++}, c: i}",
        "{a: i, ...o, b: i++}",
        "{a: i, ...[i], b: i++}",
        "{a: i, ...[i++], b: i++}",
        "{a: i, ...o, b: i++, ...[i], ...{c: i++}, d: i++}",
    ])("object literal (%p)", literal => {
        util.testFunction`
            const o = {a: "A", b: "B", c: "C"};
            let i = 0;
            const literal = ${literal};
            const result: Record<string, unknown> = {};
            (Object.keys(result) as Array<number | string>).forEach(
                key => { result[key.toString()] = literal[key]; }
            );
            return result;
        `.expectToMatchJsResult();
    });

    test("object literal with computed property names", () => {
        util.testFunction`
            let i = "A";
            const o = {[i += "B"]: i += "C", [i += "D"]: i += "E"};
            return [i, o];
        `.expectToMatchJsResult();
    });

    test("comma operator", () => {
        util.testFunction`
            let a = 0, b = 0, c = 0;
            const d = (a++, b += a, c += b);
            return [a, b, c, d];
        `.expectToMatchJsResult();
    });

    test("template expression", () => {
        util.testFunction`
            let i = 0;
            return \`\${i}, \${i++}, \${i}\`;
        `.expectToMatchJsResult();
    });

    test("tagged template literal", () => {
        util.testFunction`
            let i = 0;

            function func(strings: TemplateStringsArray, ...expressions: any[]) {
                const x = i > 0 ? "a" : "b";
                return { strings: [x, ...strings], raw: strings.raw, expressions };
            }

            return func\`hello \${i} \${i++}\`;
        `.expectToMatchJsResult();
    });

    test("binary operators", () => {
        util.testFunction`
            let i = 0;
            return i + i++;
        `.expectToMatchJsResult();
    });

    test("index expression", () => {
        util.testFunction`
            let i = 0;
            const a = [["A1", "A2"], ["B1", "B2"]];
            const result = a[i][i++];
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("index assignment statement", () => {
        util.testFunction`
            let i = 0;
            const a = [4, 5];
            a[i] = i++;
            return [a, i];
        `.expectToMatchJsResult();
    });

    test("index assignment expression", () => {
        util.testFunction`
            let i = 0;
            const a = [9, 8];
            const result = a[i] = i++;
            return [result, a, i];
        `.expectToMatchJsResult();
    });

    test("indirect index assignment statement", () => {
        util.testFunction`
            let i = 0;
            const a = [9, 8];
            const b = [7, 6];
            function foo(x: number) { if (x > 0) { return a; } else { return b; } }
            foo(i)[i] = i++;
            return [a, b, i];
        `.expectToMatchJsResult();
    });

    test("indirect index assignment expression", () => {
        util.testFunction`
            let i = 0;
            const a = [9, 8];
            const b = [7, 6];
            function foo(x: number) { if (x > 0) { return a; } else { return b; } }
            const result = foo(i)[i] = i++;
            return [result, a, b, i];
        `.expectToMatchJsResult();
    });

    test("compound index assignment statement", () => {
        util.testFunction`
            let i = 0;
            const a = [9, 8];
            a[i] += i++;
            return [a, i];
        `.expectToMatchJsResult();
    });

    test("compound index assignment expression", () => {
        util.testFunction`
            let i = 0;
            const a = [9, 8];
            const result = a[i] += i++;
            return [result, a, i];
        `.expectToMatchJsResult();
    });

    test("compound indirect index assignment statement", () => {
        util.testFunction`
            let i = 0;
            const a = [9, 8];
            const b = [7, 6];
            function foo(x: number) { if (x > 0) { return a; } else { return b; } }
            foo(i)[i] += i++;
            return [a, b, i];
        `.expectToMatchJsResult();
    });

    test("compound indirect index assignment expression", () => {
        util.testFunction`
            let i = 1;
            const a = [9, 8];
            const b = [7, 6];
            function foo(x: number) { if (x > 0) { return a; } else { return b; } }
            const result = foo(i)[i] += i++;
            return [result, a, b, i];
        `.expectToMatchJsResult();
    });

    test("array destructuring assignment statement", () => {
        util.testFunction`
            const a = [10, 9, 8, 7, 6, 5];
            let i = 0;
            [a[i], a[i++]] = [i++, i++];
            return [a, i];
        `.expectToMatchJsResult();
    });

    test("array destructuring assignment expression", () => {
        util.testFunction`
            const a = [10, 9, 8, 7, 6, 5];
            let i = 0;
            const x = [a[i], a[i++]] = [i++, i++];
            return [a, i, x];
        `.expectToMatchJsResult();
    });

    test("array destructuring assignment statement with default", () => {
        util.testFunction`
            const a = [10, 9, 8, 7, 6, 5];
            let i = 0;
            [a[i] = i++, a[i++]] = [i++, i++];
            return [a, i];
        `.expectToMatchJsResult();
    });

    test("array destructuring assignment expression with default", () => {
        util.testFunction`
            const a = [10, 9, 8, 7, 6, 5];
            let i = 0;
            const x = [a[i] = i++, a[i++]] = [i++, i++];
            return [a, i, x];
        `.expectToMatchJsResult();
    });

    test("array destructuring assignment statement with spread", () => {
        util.testFunction`
            let i = 0;
            let a: number[][] = [[9, 9, 9], [9, 9, 9], [9, 9, 9]];
            [a[0][i], ...a[i++]] = [i++, i++];
            return [a, i];
        `.expectToMatchJsResult();
    });

    test("array destructuring assignment expression with spread", () => {
        util.testFunction`
            let i = 0;
            let a: number[][] = [[9, 9, 9], [9, 9, 9], [9, 9, 9]];
            const x = [a[0][i], ...a[i++]] = [i++, i++];
            return [a, i, x];
        `.expectToMatchJsResult();
    });

    test("object destructuring assignment statement", () => {
        util.testFunction`
            let i = "A";
            const o: Record<string, string> = {ABCDEFG: "success", result: ""};
            function getO(x: string) { i = x + "C"; return o; }
            function getO2(x: string) { i = x + "G"; return o; }
            function getI(x: string) { i = x + "E"; return i; }
            ({ [getI(i += "D")]: getO2(i += "F").result } = getO(i += "B"));
            return [i, o];
        `.expectToMatchJsResult();
    });

    test("object destructuring assignment statement with default", () => {
        util.testFunction`
            let i = "A";
            const o: Record<string, string> = {ABCDEFGHIJ: "success", result: ""};
            function getO(x: string) { i = x + "C"; return o; }
            function getO2(x: string) { i = x + "G"; return o; }
            function getO3(x: string) { i = x + "I"; return o; }
            function getI(x: string): any { i = x + "E"; return undefined; }
            ({ [getI(i += "D")]: getO2(i += "F").result = getO3(i += "H")[i += "J"] } = getO(i += "B"));
            return [o, i];
        `.expectToMatchJsResult();
    });

    test("object destructuring assignment expression", () => {
        util.testFunction`
            let i = "A";
            const o: Record<string, string> = {ABCDEFG: "success", result: ""};
            function getO(x: string) { i = x + "C"; return o; }
            function getO2(x: string) { i = x + "G"; return o; }
            function getI(x: string) { i = x + "E"; return i; }
            const x = ({ [getI(i += "D")]: getO2(i += "F").result } = getO(i += "B"));
            return [i, o, x];
        `.expectToMatchJsResult();
    });

    test("object destructuring assignment expression with default", () => {
        util.testFunction`
            let i = "A";
            const o: Record<string, string> = {ABCDEFGHIJ: "success", result: ""};
            function getO(x: string) { i = x + "C"; return o; }
            function getO2(x: string) { i = x + "G"; return o; }
            function getO3(x: string) { i = x + "I"; return o; }
            function getI(x: string): any { i = x + "E"; return undefined; }
            const x = ({ [getI(i += "D")]: getO2(i += "F").result = getO3(i += "H")[i += "J"] } = getO(i += "B"));
            return [o, i, x];
        `.expectToMatchJsResult();
    });

    test("object destructuring declaration", () => {
        util.testFunction`
            let i = "A";
            const o: Record<string, string> = {ABCDE: "success"};
            function getO(x: string) { i = x + "C"; return o; }
            function getI(x: string) { i = x + "E"; return i; }
            const { [getI(i += "D")]: result } = getO(i += "B");
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("object destructuring declaration with default", () => {
        util.testFunction`
            let i = "A";
            const o: Record<string, string> = {ABCDEFGH: "success"};
            function getO(x: string) { i = x + "C"; return o; }
            function getO2(x: string) { i = x + "G"; return o; }
            function getI(x: string): any { i = x + "E"; return undefined; }
            const { [getI(i += "D")]: result = getO2(i += "F")[i += "H"]} = getO(i += "B");
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("call expression", () => {
        util.testFunction`
            let i = 1;
            function a(x: number) { return x * 10; }
            function b(x: number) { return x * 100; }
            function foo(x: number) { if (x > 0) { return a; } else { return b; } }
            const result = foo(i)(i++);
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("call expression (function modified)", () => {
        util.testFunction`
            let i = 1;
            let foo = (x: null, y: number) => { return y; };
            function bar() {
                foo = (x: null, y: number) => { return y * 10; };
                return null;
            }
            const result = foo(bar(), i++);
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("method call expression (method modified)", () => {
        util.testFunction`
            let i = 1;
            let o = {
                val: 3,
                foo(x: null, y: number) { return y + this.val; }
            };
            function changeFoo(this: void) {
                o.foo = function(x: null, y: number) { return (y + this.val) * 10; };
                return null;
            }
            const result = o.foo(changeFoo(), i++);
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("method element access call expression (method modified)", () => {
        util.testFunction`
            let i = 1;
            let o = {
                val: 3,
                foo(x: null, y: number) { return y + this.val; }
            };
            function changeFoo(this: void) {
                o.foo = function(x: null, y: number) { return (y + this.val) * 10; };
                return null;
            }
            function getFoo() { return "foo" as const; }
            function getO() { return o; }
            const result = getO()[getFoo()](changeFoo(), i++);
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("method call expression (object modified)", () => {
        util.testFunction`
            let i = 1;
            let o = {
                val: 3,
                foo(x: null, y: number) { return y + this.val; }
            };
            function changeO(this: void) {
                o = {
                    val: 5,
                    foo: function(x: null, y: number) { return (y + this.val) * 10; }
                };
                return null;
            }
            const result = o.foo(changeO(), i++);
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("method element access call expression (object modified)", () => {
        util.testFunction`
            let i = 1;
            let o = {
                val: 3,
                foo(x: null, y: number) { return y + this.val; }
            };
            function changeO(this: void) {
                o = {
                    val: 5,
                    foo: function(x: null, y: number) { return (y + this.val) * 10; }
                };
                return null;
            }
            function getFoo() { return "foo" as const; }
            function getO() { return o; }
            const result = getO()[getFoo()](changeO(), i++);
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("array method call", () => {
        util.testFunction`
            let a = [7];
            let b = [9];
            function foo(x: number) { if (x > 0) { return b; } else { return a; } }
            let i = 0;
            foo(i).push(i, i++, i);
            return [a, b, i];
        `.expectToMatchJsResult();
    });

    test("function method call", () => {
        util.testFunction`
            let o = {val: 3};
            let a = function(x: number) { return this.val + x; };
            let b = function(x: number) { return (this.val + x) * 10; };
            function foo(x: number) { if (x > 0) { return b; } else { return a; } }
            let i = 0;
            const result = foo(i).call(o, i++);
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("string method call", () => {
        util.testFunction`
            function foo(x: number) { if (x > 0) { return "foo"; } else { return "bar"; } }
            let i = 0;
            const result = foo(i).substr(++i);
            return [result, i];
        `.expectToMatchJsResult();
    });

    test("new call", () => {
        util.testFunction`
            class A { public val = 3; constructor(x: number) { this.val += x; } };
            class B { public val = 5; constructor(x: number) { this.val += (x * 10); } };
            function foo(x: number) { if (x > 0) { return B; } else { return A; } }
            let i = 0;
            const result = new (foo(i))(i++).val;
            return [result, i];
        `.expectToMatchJsResult();
    });
});

describe("loop expressions", () => {
    test("while loop", () => {
        util.testFunction`
            let i = 0, j = 0;
            while (i++ < 5) {
                ++j;
                if (j >= 10) {
                    break;
                }
            }
            return i;
        `.expectToMatchJsResult();
    });

    test("for loop", () => {
        util.testFunction`
            let i: number, j: number;
            for (i = 0, j = 0; i++ < 5 && j < 10; ++j) {}
            return i;
        `.expectToMatchJsResult();
    });

    test("do while loop", () => {
        util.testFunction`
            let i = 0, j = 0;
            do {
                ++j;
                if (j >= 10) {
                    break;
                }
            } while (i++ < 5);
            return i;
        `.expectToMatchJsResult();
    });

    test("do while loop scoping", () => {
        util.testFunction`
            let x = 0;
            let result = 0;
            do {
                let x = -10;
                ++result;
            } while (x++ >= 0 && result < 2);
            return result;
        `.expectToMatchJsResult();
    });
});

test("switch scoping", () => {
    util.testFunction`
        let i = 0;
        let x = 0;
        let result = "";
        switch (x) {
            case i++:
                result = "test";
                break;
            case i++:
        }
        return [i, result];
    `.expectToMatchJsResult();
});

test("else if", () => {
    util.testFunction`
        let i = 0;
        if (i++ === 0) {
        } else if (i++ === 1) {
        }
        return i;
    `.expectToMatchJsResult();
});
