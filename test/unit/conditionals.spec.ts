import { Expect, Test, TestCase } from "alsatian";
import * as util from "../src/util";

export class LuaConditionalsTests {

    @TestCase(0, 0)
    @TestCase(1, 1)
    @Test("if")
    public if(inp: number, expected: number): void {
        // Transpile
        const lua = util.transpileString(
            `let input = ${inp}
            if (input === 0) {
                return 0;
            }
            return 1;`
        );

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(expected);
    }

    @TestCase(0, 0)
    @TestCase(1, 1)
    @Test("ifelse")
    public ifelse(inp: number, expected: number): void {
        // Transpile
        const lua = util.transpileString(
            `let input = ${inp}
            if (input === 0) {
                return 0;
            } else {
                return 1;
            }`
        );

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(expected);
    }

    @TestCase(0, 0)
    @TestCase(1, 1)
    @TestCase(2, 2)
    @TestCase(3, 3)
    @Test("ifelseif")
    public ifelseif(inp: number, expected: number): void {
        // Transpile
        const lua = util.transpileString(
            `let input = ${inp}
            if (input === 0) {
                return 0;
            } else if (input === 1){
                return 1;
            } else if (input === 2){
                return 2;
            }
            return 3;`
        );

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(expected);
    }

    @TestCase(0, 0)
    @TestCase(1, 1)
    @TestCase(2, 2)
    @TestCase(3, 3)
    @Test("ifelseifelse")
    public ifelseifelse(inp: number, expected: number): void {
        // Transpile
        const lua = util.transpileString(
            `let input = ${inp}
            if (input === 0) {
                return 0;
            } else if (input === 1){
                return 1;
            } else if (input === 2){
                return 2;
            } else {
                return 3;
            }`
        );

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(expected);
    }

    @TestCase(0, 0)
    @TestCase(1, 1)
    @TestCase(2, 2)
    @TestCase(3, -1)
    @Test("switch")
    public switch(inp: number, expected: number): void {
        // Transpile
        const lua = util.transpileString(
            `let result = -1;

            switch (${inp}) {
                case 0:
                    result = 0;
                    break;
                case 1:
                    result = 1;
                    break;
                case 2:
                    result = 2;
                    break;
            }
            return result;`
        );

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(expected);
    }

    @TestCase(0, 0)
    @TestCase(1, 1)
    @TestCase(2, 2)
    @TestCase(3, -2)
    @Test("switchdefault")
    public switchdefault(inp: number, expected: number): void {
        // Transpile
        const lua = util.transpileString(
            `let result = -1;

            switch (${inp}) {
                case 0:
                    result = 0;
                    break;
                case 1:
                    result = 1;
                    break;
                case 2:
                    result = 2;
                    break;
                default:
                    result = -2;
                    break;
            }
            return result;`
        );

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(expected);
    }

    @TestCase(0, 1)
    @TestCase(0, 1)
    @TestCase(2, 4)
    @TestCase(3, 4)
    @TestCase(4, 4)
    @TestCase(5, 15)
    @TestCase(7, -2)
    @Test("switchfallthrough")
    public switchfallthrough(inp: number, expected: number): void {
        /// Transpile
        const lua = util.transpileString(
            `let result = -1;

            switch (${inp}) {
                case 0:
                    result = 0;
                case 1:
                    result = 1;
                    break;
                case 2:
                    result = 2;
                case 3:
                case 4:
                    result = 4;
                    break;
                case 5:
                    result = 5;
                case 6:
                    result += 10;
                    break;
                case 7:
                    result = 7;
                default:
                    result = -2;
                    break;
            }
            return result;`
        );

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(expected);
    }

    @TestCase(0, 0)
    @TestCase(1, 1)
    @TestCase(2, 2)
    @TestCase(3, -2)
    @Test("nestedSwitch")
    public nestedSwitch(inp: number, expected: number): void {
        // Transpile
        const lua = util.transpileString(
            `let result = -1;

            switch (${inp}) {
                case 0:
                    result = 0;
                    break;
                case 1:
                    switch(${inp}) {
                        case 0:
                            result = 0;
                            break;
                        case 1:
                            result = 1;
                            break;
                        default:
                            result = -3;
                            break;
                    }
                    break;
                case 2:
                    result = 2;
                    break;
                default:
                    result = -2;
                    break;
            }
            return result;`
        );

        // Execute
        const result = util.executeLua(lua);

        // Assert
        Expect(result).toBe(expected);
    }

    @Test("If dead code after return")
    public ifDeadCodeAfterReturn(): void {
        const result = util.transpileAndExecute(
            `if (true) { return 3; const b = 8; }`);

        Expect(result).toBe(3);
    }

    @Test("switch dead code after return")
    public whileDeadCodeAfterReturn(): void {
        const result = util.transpileAndExecute(
            `switch ("abc") { case "def": return 4; let abc = 4; case "abc": return 5; let def = 6; }`);

        Expect(result).toBe(5);
    }
}
