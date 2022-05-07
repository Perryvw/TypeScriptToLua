import * as util from "../../util";

test("normal TSTL creates global variables", () => {
    const builder = util.testModule`
        function foo() {}
        const bar = 123;
    `
        .expectToHaveNoDiagnostics();

    const transpiledFile = builder.getLuaResult().transpiledFiles[0];
    util.assert(transpiledFile !== undefined);
    const { lua } =  transpiledFile;
    util.assert(lua !== undefined);
    expect(lua).not.toContain("local");
});

test("noImplicitGlobalVariables does not create any global variables", () => {
    const builder = util.testModule`
        function foo() {}
        const bar = 123;
    `
        .setOptions({ noImplicitGlobalVariables: true })
        .expectToHaveNoDiagnostics();

    const transpiledFile = builder.getLuaResult().transpiledFiles[0];
    util.assert(transpiledFile !== undefined);
    const { lua } =  transpiledFile;
    util.assert(lua !== undefined);
    expect(lua).toContain("local function foo(");
    expect(lua).toContain("local bar =");
});
