import { annotationInvalidArgumentCount } from "../../../src/transformation/utils/diagnostics";
import * as util from "../../util";

test("CustomCreate", () => {
    const luaHeader = `
        function Point2DCreate(x, y)
            return {x = x, y = y}
        end
    `;

    const tsHeader = `
        /** @customConstructor Point2DCreate */
        class Point2D {
            public x: number;
            public y: number;
            constructor(x: number, y: number) {
                // No values assigned
            }
        }
    `;

    // Can't use expectToMatchJsResult because above is not valid TS/JS
    util.testModule`export default new Point2D(1, 2).x;`
        .setTsHeader(tsHeader)
        .setLuaHeader(luaHeader)
        .setReturnExport("default")
        .expectToEqual(1);
});

test("IncorrectUsage", () => {
    util.testFunction`
        /** @customConstructor */
        class Point2D {}

        new Point2D();
    `.expectDiagnosticsToMatchSnapshot([annotationInvalidArgumentCount.code]);
});
