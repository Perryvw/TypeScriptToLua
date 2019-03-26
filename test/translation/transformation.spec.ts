import * as fs from "fs";
import * as path from "path";
import * as util from "../util";
import { LuaLibImportKind } from "../../src/CompilerOptions";

const fixturesPath = path.join(__dirname, "./transformation");
const fixtures = fs
    .readdirSync(fixturesPath)
    .filter(f => path.extname(f) === ".ts")
    .map(f => [path.parse(f).name, fs.readFileSync(path.join(fixturesPath, f), "utf8")]);

test.each(fixtures)("Transformation (%s)", (_name, content) => {
    const result = util.transpileString(content, { luaLibImport: LuaLibImportKind.Require });
    expect(result).toMatchSnapshot();
});
