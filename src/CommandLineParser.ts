import * as path from "path";
import * as ts from "typescript";
import { CompilerOptions, LuaLibImportKind, LuaTarget } from "./CompilerOptions";
import * as diagnostics from "./diagnostics";

export interface ParsedCommandLine extends ts.ParsedCommandLine {
    options: CompilerOptions;
}

interface CommandLineOptionBase {
    name: string;
    aliases?: string[];
    description: string;
    isTSConfigOnly?: boolean;
}

interface CommandLineOptionOfEnum extends CommandLineOptionBase {
    type: "enum";
    choices: string[];
}

interface CommandLineOptionOfBoolean extends CommandLineOptionBase {
    type: "boolean";
}

interface CommandLineOptionOfListType extends CommandLineOptionBase {
    isTSConfigOnly: true;
    type: "list";
}

type CommandLineOption =
    | CommandLineOptionOfEnum
    | CommandLineOptionOfBoolean
    | CommandLineOptionOfListType;

const optionDeclarations: CommandLineOption[] = [
    {
        name: "luaLibImport",
        description: "Specifies how js standard features missing in lua are imported.",
        type: "enum",
        choices: Object.values(LuaLibImportKind),
    },
    {
        name: "luaTarget",
        aliases: ["lt"],
        description: "Specify Lua target version.",
        type: "enum",
        choices: Object.values(LuaTarget),
    },
    {
        name: "noHeader",
        description: "Specify if a header will be added to compiled files.",
        type: "boolean",
    },
    {
        name: "noHoisting",
        description: "Disables hoisting.",
        type: "boolean",
    },
    {
        name: "sourceMapTraceback",
        description:
            "Applies the source map to show source TS files and lines in error tracebacks.",
        type: "boolean",
    },
    {
        name: "tsTransformers",
        description: "Custom TypeScript transformers.",
        isTSConfigOnly: true,
        type: "list",
    },
];

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
    for (const option of optionDeclarations) {
        if (option.isTSConfigOnly) continue;

        const aliasStrings = (option.aliases || []).map(a => "-" + a);
        const optionString = aliasStrings.concat(["--" + option.name]).join("|");

        const valuesHint = option.type === "enum" ? option.choices.join("|") : option.type;
        const spacing = " ".repeat(Math.max(1, 45 - optionString.length - valuesHint.length));

        result += `\n ${optionString} <${valuesHint}>${spacing}${option.description}\n`;
    }

    return result;
}

export function updateParsedConfigFile(parsedConfigFile: ts.ParsedCommandLine): ParsedCommandLine {
    let hasRootLevelOptions = false;
    for (const key in parsedConfigFile.raw) {
        const option = optionDeclarations.find(option => option.name === key);
        if (!option) continue;

        if (parsedConfigFile.raw.tstl === undefined) parsedConfigFile.raw.tstl = {};
        parsedConfigFile.raw.tstl[key] = parsedConfigFile.raw[key];
        hasRootLevelOptions = true;
    }

    if (parsedConfigFile.raw.tstl) {
        if (hasRootLevelOptions) {
            parsedConfigFile.errors.push(
                diagnostics.tstlOptionsAreMovingToTheTstlObject(parsedConfigFile.raw.tstl)
            );
        }

        for (const key in parsedConfigFile.raw.tstl) {
            const option = optionDeclarations.find(option => option.name === key);
            if (!option) {
                parsedConfigFile.errors.push(diagnostics.unknownCompilerOption(key));
                continue;
            }

            const { error, value } = readValue(option, parsedConfigFile.raw.tstl[key]);
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
    for (let i = 0; i < args.length; i++) {
        if (!args[i].startsWith("-")) continue;

        const isShorthand = !args[i].startsWith("--");
        const argumentName = args[i].substr(isShorthand ? 1 : 2);
        const option = optionDeclarations.find(option => {
            if (option.name.toLowerCase() === argumentName.toLowerCase()) return true;
            if (isShorthand && option.aliases) {
                return option.aliases.some(a => a.toLowerCase() === argumentName.toLowerCase());
            }

            return false;
        });

        if (option) {
            // Ignore errors caused by tstl specific compiler options
            const tsInvalidCompilerOptionErrorCode = 5023;
            parsedCommandLine.errors = parsedCommandLine.errors.filter(err => {
                return !(
                    err.code === tsInvalidCompilerOptionErrorCode &&
                    String(err.messageText).endsWith(`'${args[i]}'.`)
                );
            });

            const { error, value, increment } = readCommandLineArgument(option, args[i + 1]);
            if (error) parsedCommandLine.errors.push(error);
            parsedCommandLine.options[option.name] = value;
            i += increment;
        }
    }

    return parsedCommandLine;
}

interface CommandLineArgument extends ReadValueResult {
    increment: number;
}

function readCommandLineArgument(option: CommandLineOption, value: any): CommandLineArgument {
    if (option.isTSConfigOnly) {
        return {
            value: undefined,
            error: diagnostics.optionCanOnlyBeSpecifiedInTsconfigJsonFile(option.name),
            increment: 0,
        };
    }

    if (option.type === "boolean") {
        if (value === "true" || value === "false") {
            value = value === "true";
        } else {
            // Set boolean arguments without supplied value to true
            return { value: true, increment: 0 };
        }
    }

    if (value === undefined) {
        return {
            error: diagnostics.compilerOptionExpectsAnArgument(option.name),
            value: undefined,
            increment: 0,
        };
    }

    return { ...readValue(option, value), increment: 1 };
}

interface ReadValueResult {
    error?: ts.Diagnostic;
    value: any;
}

function readValue(option: CommandLineOption, value: unknown): ReadValueResult {
    if (value === null) return { value };

    switch (option.type) {
        case "boolean": {
            if (typeof value !== "boolean") {
                return {
                    value: undefined,
                    error: diagnostics.compilerOptionRequiresAValueOfType(option.name, "boolean"),
                };
            }

            return { value };
        }

        case "enum": {
            if (typeof value !== "string") {
                return {
                    value: undefined,
                    error: diagnostics.compilerOptionRequiresAValueOfType(option.name, "string"),
                };
            }

            const normalizedValue = value.toLowerCase();
            if (option.choices && !option.choices.includes(normalizedValue)) {
                const optionChoices = option.choices.join(", ");
                return {
                    value: undefined,
                    error: diagnostics.argumentForOptionMustBe(`--${option.name}`, optionChoices),
                };
            }

            return { value: normalizedValue };
        }

        case "list": {
            if (!Array.isArray(value)) {
                return {
                    value: undefined,
                    error: diagnostics.compilerOptionRequiresAValueOfType(option.name, "Array"),
                };
            }

            return { value };
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
