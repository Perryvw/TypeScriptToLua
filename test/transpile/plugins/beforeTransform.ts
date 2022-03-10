import * as ts from "typescript";
import * as tstl from "../../../src";

const plugin: tstl.Plugin = {
    beforeTransform(program: ts.Program, options: tstl.CompilerOptions, emitHost: tstl.EmitHost) {
        void program;
        void emitHost;

        // Modify settings
        options.outDir = "plugin/beforeTransform/outdir";
    },
};

// eslint-disable-next-line import/no-default-export
export default plugin;
