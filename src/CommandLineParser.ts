import * as path from "path";
import * as ts from "typescript";
import { CompilerOptions, LuaLibImportKind, LuaTarget } from "./CompilerOptions";
import * as diagnostics from "./diagnostics";

export interface ParsedCommandLine extends ts.ParsedCommandLine {
    options: CompilerOptions;
}

interface CommandLineOptionBase {
    describe: string;
    aliases?: string[];
}

interface CommandLineOptionOfEnum extends CommandLineOptionBase {
    type: "enum";
    choices: string[];
}

interface CommandLineOptionOfBoolean extends CommandLineOptionBase {
    type: "boolean";
}

type CommandLineOption = CommandLineOptionOfEnum | CommandLineOptionOfBoolean;
const optionDeclarations: Record<string, CommandLineOption> = {
    luaLibImport: {
        describe: "Specifies how js standard features missing in lua are imported.",
        type: "enum",
        choices: Object.values(LuaLibImportKind),
    },
    luaTarget: {
        aliases: ["lt"],
        describe: "Specify Lua target version.",
        type: "enum",
        choices: Object.values(LuaTarget),
    },
    noHeader: {
        describe: "Specify if a header will be added to compiled files.",
        type: "boolean",
    },
    noHoisting: {
        describe: "Disables hoisting.",
        type: "boolean",
    },
    sourceMapTraceback: {
        describe: "Applies the source map to show source TS files and lines in error tracebacks.",
        type: "boolean",
    },
};

export const version = `Version ${require("../package.json").version}`;

const helpString = `
Syntax:   tstl [options] [files...]

Examples: tstl path/to/file.ts [...]
          tstl -p path/to/tsconfig.json

In addition to the options listed below you can also pass options
for the typescript compiler (For a list of options use tsc -h).
Some tsc options might have no effect.
`.trim();

export function getHelpString(): string {
    let result = helpString + "\n\n";

    result += "Options:\n";
    for (const [optionName, option] of Object.entries(optionDeclarations)) {
        const aliasStrings = (option.aliases || []).map(a => "-" + a);

        const optionString = aliasStrings.concat(["--" + optionName]).join("|");

        const optionDescribe = option.type === "enum" ? option.choices.join("|") : option.type;

        const spacing = " ".repeat(Math.max(1, 45 - optionString.length - optionDescribe.length));

        result += `\n ${optionString} <${optionDescribe}>${spacing}${option.describe}\n`;
    }

    return result;
}

export function updateParsedConfigFile(parsedConfigFile: ts.ParsedCommandLine): ParsedCommandLine {
    for (const key in parsedConfigFile.raw) {
        const option = optionDeclarations[key];
        if (!option) continue;

        // console.warn(`[Deprectated] TSTL options are moving to the luaConfig object. Adjust your tsconfig to `
        //    + `look like { "compilerOptions": { <typescript options> }, "tstl": { <tstl options> } }`);

        const { error, value } = readValue(key, option, parsedConfigFile.raw[key]);
        if (error) parsedConfigFile.errors.push(error);
        if (parsedConfigFile.options[key] === undefined) parsedConfigFile.options[key] = value;
    }

    // Eventually we will only look for the tstl object for tstl options
    if (parsedConfigFile.raw.tstl) {
        for (const key in parsedConfigFile.raw.tstl) {
            const option = optionDeclarations[key];
            if (!option) continue;

            const { error, value } = readValue(key, option, parsedConfigFile.raw.tstl[key]);
            if (error) parsedConfigFile.errors.push(error);
            if (parsedConfigFile.options[key] === undefined) parsedConfigFile.options[key] = value;
        }
    }

    return parsedConfigFile;
}

export function parseCommandLine(args: string[]): ParsedCommandLine {
    return updateParsedCommandLine(ts.parseCommandLine(args), args);
}

function updateParsedCommandLine(
    parsedCommandLine: ts.ParsedCommandLine,
    args: string[]
): ParsedCommandLine {
    // Generate a list of valid option names and aliases
    const optionNames = Object.keys(optionDeclarations)
        .map(n => `--${n}`)
        .concat(...Object.values(optionDeclarations).map(o => (o.aliases || []).map(a => `-${a}`)));

    // Ignore errors caused by tstl specific compiler options
    const tsInvalidCompilerOptionErrorCode = 5023;
    parsedCommandLine.errors = parsedCommandLine.errors.filter(err => {
        return !(
            err.code === tsInvalidCompilerOptionErrorCode &&
            optionNames.some(optionName => String(err.messageText).endsWith(`'${optionName}'.`))
        );
    });

    for (let i = 0; i < args.length; i++) {
        if (!args[i].startsWith("-")) continue;

        const hasTwoDashes = args[i].startsWith("--");
        const argumentName = args[i].substr(hasTwoDashes ? 2 : 1);
        let optionName = optionDeclarations[argumentName] && argumentName;
        if (!hasTwoDashes && optionName === undefined) {
            for (const key in optionDeclarations) {
                if ((optionDeclarations[key].aliases || []).includes(argumentName)) {
                    optionName = key;
                    break;
                }
            }
        }

        if (optionName !== undefined) {
            const { error, value, increment } = readCommandLineArgument(optionName, args[i + 1]);
            if (error) parsedCommandLine.errors.push(error);
            parsedCommandLine.options[optionName] = value;
            i += increment;
        }
    }

    return parsedCommandLine;
}

interface CommandLineArgument extends ReadValueResult {
    increment: number;
}

function readCommandLineArgument(optionName: string, value: any): CommandLineArgument {
    const option = optionDeclarations[optionName];

    if (option.type === "boolean") {
        if (value === "true" || value === "false") {
            value = value === "true";
        } else {
            // Set boolean arguments without supplied value to true
            return { value: true, increment: 0 };
        }
    } else if (value === undefined) {
        return {
            error: diagnostics.compilerOptionExpectsAnArgument(optionName),
            value: undefined,
            increment: 0,
        };
    }

    return { ...readValue(optionName, option, value), increment: 1 };
}

interface ReadValueResult {
    error?: ts.Diagnostic;
    value: any;
}

function readValue(optionName: string, option: CommandLineOption, value: unknown): ReadValueResult {
    if (value === null) return { value };

    switch (option.type) {
        case "boolean": {
            if (typeof value !== "boolean") {
                return {
                    value: undefined,
                    error: diagnostics.compilerOptionRequiresAValueOfType(optionName, "boolean"),
                };
            }

            return { value };
        }

        case "enum": {
            if (typeof value !== "string") {
                return {
                    value: undefined,
                    error: diagnostics.compilerOptionRequiresAValueOfType(optionName, "string"),
                };
            }

            const normalizedValue = value.toLowerCase();
            if (option.choices && !option.choices.includes(normalizedValue)) {
                const optionChoices = option.choices.join(", ");
                return {
                    value: undefined,
                    error: diagnostics.argumentForOptionMustBe(`--${optionName}`, optionChoices),
                };
            }

            return { value: normalizedValue };
        }
    }
}

export function parseConfigFileWithSystem(
    configFileName: string,
    commandLineOptions?: CompilerOptions,
    system = ts.sys
): ParsedCommandLine {
    const parsedConfigFile = ts.parseJsonSourceFileConfigFileContent(
        ts.readJsonConfigFile(configFileName, system.readFile),
        system,
        path.dirname(configFileName),
        commandLineOptions,
        configFileName
    );

    return updateParsedConfigFile(parsedConfigFile);
}
