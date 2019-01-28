import { Expect, Test, TestCase } from "alsatian";

import * as util from "../src/util";

export class HoistingTests {

    @Test("Var Hoisting")
    public varHoisting(): void {
        const code =
            `foo = "foo";
            var foo;
            return foo;`;
        const result = util.transpileAndExecute(code);
        Expect(result).toBe("foo");
    }

    @Test("Exported Var Hoisting")
    public exportedVarHoisting(): void {
        const code =
            `foo = "foo";
            export var foo;`;
        const result = util.transpileExecuteAndReturnExport(code, "foo");
        Expect(result).toBe("foo");
    }

    @TestCase("let")
    @TestCase("const")
    @Test("Let/Const Hoisting")
    public letConstHoisting(varType: string): void {
        const code =
            `let bar: string;
            function setBar() { bar = foo; }
            ${varType} foo = "foo";
            setBar();
            return foo;`;
        const result = util.transpileAndExecute(code);
        Expect(result).toBe("foo");
    }

    @TestCase("let")
    @TestCase("const")
    @Test("Exported Let/Const Hoisting")
    public exportedLetConstHoisting(varType: string): void {
        const code =
            `let bar: string;
            function setBar() { bar = foo; }
            export ${varType} foo = "foo";
            setBar();`;
        const result = util.transpileExecuteAndReturnExport(code, "foo");
        Expect(result).toBe("foo");
    }

    @Test("Global Function Hoisting")
    public globalFunctionHoisting(): void {
        const code =
            `const foo = bar();
            function bar() { return "bar"; }
            return foo;`;
        const result = util.transpileAndExecute(code);
        Expect(result).toBe("bar");
    }

    @Test("Local Function Hoisting")
    public localFunctionHoisting(): void {
        const code =
            `export const foo = bar();
            function bar() { return "bar"; }`;
        const result = util.transpileExecuteAndReturnExport(code, "foo");
        Expect(result).toBe("bar");
    }

    @Test("Exported Function Hoisting")
    public exportedFunctionHoisting(): void {
        const code =
            `const foo = bar();
            export function bar() { return "bar"; }
            export const baz = foo;`;
        const result = util.transpileExecuteAndReturnExport(code, "baz");
        Expect(result).toBe("bar");
    }

    @Test("Namespace Function Hoisting")
    public namespaceFunctionHoisting(): void {
        const code =
            `let foo: string;
            namespace NS {
                foo = bar();
                function bar() { return "bar"; }
            }`;
        const result = util.transpileAndExecute("return foo;", undefined, undefined, code);
        Expect(result).toBe("bar");
    }

    @Test("Exported Namespace Function Hoisting")
    public exportedNamespaceFunctionHoisting(): void {
        const code =
            `let foo: string;
            namespace NS {
                foo = bar();
                export function bar() { return "bar"; }
            }`;
        const result = util.transpileAndExecute("return foo;", undefined, undefined, code);
        Expect(result).toBe("bar");
    }

    @TestCase("var", "foo")
    @TestCase("let", "bar")
    @TestCase("const", "bar")
    @Test("Hoisting in Non-Function Scope")
    public hoistingInNonFunctionScope(varType: string, expectResult: string): void {
        const code =
            `function foo() {
                ${varType} bar = "bar";
                for (let i = 0; i < 1; ++i) {
                    ${varType} bar = "foo";
                }
                return bar;
            }
            return foo();`;
        const result = util.transpileAndExecute(code);
        Expect(result).toBe(expectResult);
    }

    @Test("Namespace Hoisting")
    public namespaceHoisting(): void {
        const code =
            `function bar() {
                return NS.foo;
            }
            namespace NS {
                export let foo = "foo";
            }
            export const foo = bar();`;
        const result = util.transpileExecuteAndReturnExport(code, "foo");
        Expect(result).toBe("foo");
    }

    @Test("Exported Namespace Hoisting")
    public exportedNamespaceHoisting(): void {
        const code =
            `function bar() {
                return NS.foo;
            }
            export namespace NS {
                export let foo = "foo";
            }
            export const foo = bar();`;
        const result = util.transpileExecuteAndReturnExport(code, "foo");
        Expect(result).toBe("foo");
    }

    @Test("Nested Namespace Hoisting")
    public nestedNamespaceHoisting(): void {
        const code =
            `export namespace Outer {
                export function bar() {
                    return Inner.foo;
                }
                namespace Inner {
                    export let foo = "foo";
                }
            }
            export const foo = Outer.bar();`;
        const result = util.transpileExecuteAndReturnExport(code, "foo");
        Expect(result).toBe("foo");
    }

    @Test("Class Hoisting")
    public classHoisting(): void {
        const code =
            `function makeFoo() {
                return new Foo();
            }
            class Foo {
                public bar = "foo";
            }
            export const foo = makeFoo().bar;`;
        const result = util.transpileExecuteAndReturnExport(code, "foo");
        Expect(result).toBe("foo");
    }

    @Test("Enum Hoisting")
    public enumHoisting(): void {
        const code =
            `function bar() {
                return E.A;
            }
            enum E {
                A = "foo"
            }
            export const foo = bar();`;
        const result = util.transpileExecuteAndReturnExport(code, "foo");
        Expect(result).toBe("foo");
    }
}
