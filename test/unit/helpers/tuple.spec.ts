import * as util from "../../util";
import { InvalidTupleFunctionUse } from "../../../src/transformation/utils/errors";

test.each<[string, any]>([
    ["let a; [a] = tuple();", undefined],
    ["const [a] = tuple();", undefined],
    ["const [a] = tuple(1);", 1],
    ["const ar = [1]; const [a] = tuple(...ar);", 1],
    ["const _ = null, [a] = tuple(1);", 1],
    ["let a; for (const [a] = tuple(1, 2); false; 1) {}", undefined],
    ["let a; for ([a] = tuple(1, 2); false; 1) {}", 1],
])("valid tuple call and assign (%s)", (statement, result) => {
    util.testModule`
        import { tuple } from "typescript-to-lua/helpers";
        ${statement}
        export { a };
    `
        .setReturnExport("a")
        .expectToEqual(result);
});

test.each([
    "tuple",
    "tuple()",
    "({ tuple });",
    "[] = tuple()",
    "const [] = tuple();",
    "const a = tuple();",
    "const {} = tuple();",
    "([a] = tuple(1)) => {}",
])("invalid tuple call (%s)", statement => {
    util.testModule`
        import { tuple } from "typescript-to-lua/helpers";
        ${statement}
    `.expectToHaveDiagnosticOfError(InvalidTupleFunctionUse(util.nodeStub));
});

test.each<[string, any]>([
    ["return tuple();", undefined],
    ["return tuple(1);", 1],
])("valid tuple call return statement (%s)", (statement, result) => {
    util.testModule`
        import { tuple } from "typescript-to-lua/helpers";
        export const [a] = (function() {
            ${statement}
        })();
    `
        .setReturnExport("a")
        .expectToEqual(result);
});

test("tuple call with destructuring assignment side effects", () => {
    util.testModule`
        import { tuple } from "typescript-to-lua";
        let a, b;
        export { a };
        [a] = tuple(1);
    `
        .setReturnExport("a")
        .expectToEqual(1);
});
