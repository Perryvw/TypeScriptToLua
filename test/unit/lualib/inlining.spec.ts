import { Expect, Test, TestCase } from "alsatian";
import * as util from "../../src/util";

import { LuaLibImportKind, LuaTarget } from "../../../src/Transpiler";

export class InliningTests {
    @Test("map constructor")
    public mapConstructor(): void {
        const lua = util.transpileString(`let mymap = new Map(); return mymap.size;`,
                                         { luaLibImport: LuaLibImportKind.Inline, luaTarget: LuaTarget.Lua53 });
        const result = util.executeLua(lua);

        Expect(result).toBe(0);
    }

    @Test("map foreach keys")
    public mapForEachKeys(): void {
        const lua = util.transpileString(
            `let mymap = new Map([[5, 2],[6, 3],[7, 4]]);
            let count = 0;
            mymap.forEach((value, key) => { count += key; });
            return count;`,
            { luaLibImport: LuaLibImportKind.Inline, luaTarget: LuaTarget.Lua53 });

        const result = util.executeLua(lua);
        Expect(result).toBe(18);
    }

    @Test("set constructor")
    public setConstructor(): void {
        const lua = util.transpileString(`class abc {} let def = new abc(); let myset = new Set(); return myset.size;`,
                                         { luaLibImport: LuaLibImportKind.Inline, luaTarget: LuaTarget.Lua53 });
        const result = util.executeLua(lua);

        Expect(result).toBe(0);
    }

    @Test("set foreach keys")
    public setForEachKeys(): void {
        const lua = util.transpileString(
            `let myset = new Set([2, 3, 4]);
            let count = 0;
            myset.forEach((value, key) => { count += key; });
            return count;`,
            { luaLibImport: LuaLibImportKind.Inline, luaTarget: LuaTarget.Lua53 });

        const result = util.executeLua(lua);
        Expect(result).toBe(9);
    }
}
