import { Expect, Test, TestCase } from "alsatian";

import * as ts from "typescript";
import * as util from "../src/util";

export class FunctionTests {

    @Test("Arrow Function Expression")
    public arrowFunctionExpression(): void {
        // Transpile
        const lua = util.transpileString(`let add = (a, b) => a+b; return add(1,2);`);

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(3);
    }

    @TestCase("b => a = b", 5)
    @TestCase("b => a += b", 15)
    @TestCase("b => a -= b", 5)
    @TestCase("b => a *= b", 50)
    @TestCase("b => a /= b", 2)
    @TestCase("b => a **= b", 100000)
    @TestCase("b => a %= b", 0)
    @Test("Arrow function assignment")
    public arrowFunctionAssignment(lambda: string, expected: number): void {
        // Transpile
        const lua = util.transpileString(`let a = 10; let lambda = ${lambda};
                                          lambda(5); return a;`);

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(expected);
    }

    @TestCase([])
    @TestCase([5])
    @TestCase([1, 2])
    @Test("Arrow Default Values")
    public arrowFunctionDefaultValues(inp: number[]): void {
        // Default value is 3 for v1
        const v1 = inp.length > 0 ? inp[0] : 3;
        // Default value is 4 for v2
        const v2 = inp.length > 1 ? inp[1] : 4;

        const callArgs = inp.join(",");

        // Transpile
        const lua = util.transpileString(`let add = (a: number = 3, b: number = 4) => { return a+b; }`
                                       + `return add(${callArgs});`);

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(v1 + v2);
    }

    @Test("Function Expression")
    public functionExpression(): void {
        // Transpile
        const lua = util.transpileString(`let add = function(a, b) {return a+b}; return add(1,2);`);

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(3);
    }

    @TestCase([], 7)
    @TestCase([5], 9)
    @TestCase([1, 2], 3)
    @Test("Arrow Default Values")
    public functionExpressionDefaultValues(inp: number[]): void {
        // Default value is 3 for v1
        const v1 = inp.length > 0 ? inp[0] : 3;
        // Default value is 4 for v2
        const v2 = inp.length > 1 ? inp[1] : 4;

        const callArgs = inp.join(",");

        // Transpile
        const lua = util.transpileString(`let add = function(a: number = 3, b: number = 4) { return a+b; }`
                                       + `return add(${callArgs});`);

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(v1 + v2);
    }

    @Test("Class method call")
    public classMethod(): void {
        const returnValue = 4;
        const source = `class TestClass {
                            public classMethod(): number { return ${returnValue}; }
                        }

                        const classInstance = new TestClass();
                        return classInstance.classMethod();`;

        // Transpile
        const lua = util.transpileString(source);

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(returnValue);
    }

    @Test("Class dot method call void")
    public classDotMethod(): void {
        const returnValue = 4;
        const source = `class TestClass {
                            public dotMethod: () => number = () => ${returnValue};
                        }

                        const classInstance = new TestClass();
                        return classInstance.dotMethod();`;

        // Transpile
        const lua = util.transpileString(source);

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(returnValue);
    }

    @Test("Class dot method call with parameter")
    public classDotMethod2(): void {
        const returnValue = 4;
        const source = `class TestClass {
                            public dotMethod: (x: number) => number = x => 3 * x;
                        }

                        const classInstance = new TestClass();
                        return classInstance.dotMethod(${returnValue});`;

        // Transpile
        const lua = util.transpileString(source);

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(3 * returnValue);
    }

    @Test("Class static dot method")
    public classDotMethodStatic(): void {
        const returnValue = 4;
        const source = `class TestClass {
                            public static dotMethod: () => number = () => ${returnValue};
                        }

                        return TestClass.dotMethod();`;

        // Transpile
        const lua = util.transpileString(source);

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(returnValue);
    }

    @Test("Class static dot method with parameter")
    public classDotMethodStaticWithParameter(): void {
        const returnValue = 4;
        const source = `class TestClass {
                            public static dotMethod: (x: number) => number = x => 3 * x;
                        }

                        return TestClass.dotMethod(${returnValue});`;

        // Transpile
        const lua = util.transpileString(source);

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(3 * returnValue);
    }

    @Test("Invalid property access call transpilation")
    public invalidPropertyCall(): void {
        const transpiler = util.makeTestTranspiler();

        const mockObject: any = {
            expression: ts.createLiteral("abc"),
        };

        Expect(() => transpiler.transpilePropertyCall(mockObject as ts.CallExpression))
            .toThrowError(Error, "Tried to transpile a non-property call as property call.");
    }

    @Test("Function dead code after return")
    public functionDeadCodeAfterReturn(): void {
        const result = util.transpileAndExecute(
            `function abc() { return 3; const a = 5; } return abc();`);

        Expect(result).toBe(3);
    }

    @Test("Method dead code after return")
    public methodDeadCodeAfterReturn(): void {
        const result = util.transpileAndExecute(
            `class def { public static abc() { return 3; const a = 5; } } return def.abc();`);

        Expect(result).toBe(3);
    }
}
