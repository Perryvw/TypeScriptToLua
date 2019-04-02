import * as path from "path";

import {SourceNode, SourceMapGenerator, RawSourceMap, SourceMapConsumer} from "source-map";

import * as tstl from "./LuaAST";
import { CompilerOptions, LuaLibImportKind } from "./CompilerOptions";
import { LuaLib, LuaLibFeature } from "./LuaLib";
import { TSHelper as tsHelper } from "./TSHelper";

type SourceChunk = string | SourceNode;

export class LuaPrinter {
    /* tslint:disable:object-literal-sort-keys */
    private static operatorMap: {[key in tstl.Operator]: string} = {
        [tstl.SyntaxKind.AdditionOperator]: "+",
        [tstl.SyntaxKind.SubractionOperator]: "-",
        [tstl.SyntaxKind.MultiplicationOperator]: "*",
        [tstl.SyntaxKind.DivisionOperator]: "/",
        [tstl.SyntaxKind.FloorDivisionOperator]: "//",
        [tstl.SyntaxKind.ModuloOperator]: "%",
        [tstl.SyntaxKind.PowerOperator]: "^",
        [tstl.SyntaxKind.NegationOperator]: "-",
        [tstl.SyntaxKind.ConcatOperator]: "..",
        [tstl.SyntaxKind.LengthOperator]: "#",
        [tstl.SyntaxKind.EqualityOperator]: "==",
        [tstl.SyntaxKind.InequalityOperator]: "~=",
        [tstl.SyntaxKind.LessThanOperator]: "<",
        [tstl.SyntaxKind.LessEqualOperator]: "<=",
        [tstl.SyntaxKind.GreaterThanOperator]: ">",
        [tstl.SyntaxKind.GreaterEqualOperator]: ">=",
        [tstl.SyntaxKind.AndOperator]: "and",
        [tstl.SyntaxKind.OrOperator]: "or",
        [tstl.SyntaxKind.NotOperator]: "not ",
        [tstl.SyntaxKind.BitwiseAndOperator]: "&",
        [tstl.SyntaxKind.BitwiseOrOperator]: "|",
        [tstl.SyntaxKind.BitwiseExclusiveOrOperator]: "~",
        [tstl.SyntaxKind.BitwiseRightShiftOperator]: ">>",
        [tstl.SyntaxKind.BitwiseLeftShiftOperator]: "<<",
        [tstl.SyntaxKind.BitwiseNotOperator]: "~",
    };
    /* tslint:enable:object-literal-sort-keys */

    private options: CompilerOptions;
    private currentIndent: string;

    private sourceFile: string;

    public constructor(options: CompilerOptions) {
        this.options = options;
        this.currentIndent = "";
    }

    public print(block: tstl.Block, luaLibFeatures?: Set<LuaLibFeature>, sourceFile?: string): [string, string] {
        // Add traceback lualib if sourcemap traceback option is enabled
        if (this.options.sourceMapTraceback) {
            if (luaLibFeatures === undefined) {
                luaLibFeatures = new Set();
            }
            luaLibFeatures.add(LuaLibFeature.SourceMapTraceBack);
        }

        const rootSourceNode = this.printImplementation(block, luaLibFeatures, sourceFile);

        const codeWithSourceMap = rootSourceNode
            // TODO is the file: part really required? and should this be handled in the printer?
            .toStringWithSourceMap({file: path.basename(sourceFile, path.extname(sourceFile)) + ".lua"});

        let codeResult = codeWithSourceMap.code;

        if (this.options.inlineSourceMap) {
            codeResult += "\n" + this.printInlineSourceMap(codeWithSourceMap.map);
        }

        if (this.options.sourceMapTraceback) {
            const stackTraceOverride = this.printStackTraceOverride(rootSourceNode);
            codeResult = codeResult.replace("{#SourceMapTraceback}", stackTraceOverride);
        }

        return [codeResult, codeWithSourceMap.map.toString()];
    }

    private printInlineSourceMap(sourceMap: SourceMapGenerator): string {
        const map = sourceMap.toString();
        const base64Map = Buffer.from(map).toString('base64');

        return `//# sourceMappingURL=data:application/json;base64,${base64Map}\n`;
    }

    private printStackTraceOverride(rootNode: SourceNode): string {
        let line = 1;
        const map: {[line: number]: number} = {};
        rootNode.walk((chunk, mappedPosition) => {
            if (mappedPosition.line !== undefined && mappedPosition.line > 0) {
                if (map[line] === undefined) {
                    map[line] = mappedPosition.line;
                } else {
                    map[line] = Math.min(map[line], mappedPosition.line);
                }
            }
            line += chunk.split("\n").length - 1;
        });

        const mapItems = [];
        for (const lineNr in map) {
            mapItems.push(`["${lineNr}"] = ${map[lineNr]}`);
        }

        const mapString = "{" + mapItems.join(",") + "}";

        return `__TS__SourceMapTraceBack(debug.getinfo(1).short_src, ${mapString});`;
    }

    private printImplementation(
        block: tstl.Block,
        luaLibFeatures?: Set<LuaLibFeature>,
        sourceFile?: string): SourceNode {

        let header = "";

        if (this.options.noHeader === undefined || this.options.noHeader === false) {
            header += `--[[ Generated with https://github.com/TypeScriptToLua/TypeScriptToLua ]]\n`;
        }

        if (luaLibFeatures) {
            // Require lualib bundle
            if ((this.options.luaLibImport === LuaLibImportKind.Require && luaLibFeatures.size > 0)
                || this.options.luaLibImport === LuaLibImportKind.Always)
            {
                header += `require("lualib_bundle");\n`;
            }
            // Inline lualib features
            else if (this.options.luaLibImport === LuaLibImportKind.Inline && luaLibFeatures.size > 0)
            {
                header += "-- Lua Library inline imports\n";
                header += LuaLib.loadFeatures(luaLibFeatures);
            }
        }

        this.sourceFile = path.basename(sourceFile);

        if (this.options.sourceMapTraceback) {
            header += "{#SourceMapTraceback}\n";
        }

        const fileBlockNode =  this.createSourceNode(block, this.printBlock(block));

        return this.concatNodes(header, fileBlockNode);
    }

    private pushIndent(): void {
        this.currentIndent = this.currentIndent + "    ";
    }

    private popIndent(): void {
        this.currentIndent = this.currentIndent.slice(4);
    }

    private indent(input: SourceChunk = ""): SourceChunk {
        return this.concatNodes(this.currentIndent, input);
    }

    private createSourceNode(node: tstl.Node, chunks: SourceChunk | SourceChunk[]): SourceNode {
        const originalPos = tstl.getOriginalPos(node);

        return originalPos !== undefined
            ? new SourceNode(originalPos.line + 1, originalPos.column, this.sourceFile, chunks)
            : new SourceNode(undefined, undefined, this.sourceFile, chunks);
    }

    private concatNodes(...chunks: SourceChunk[]): SourceNode {
        return new SourceNode(undefined, undefined, this.sourceFile, chunks);
    }

    private printBlock(block: tstl.Block): SourceNode {
        return this.createSourceNode(
            block,
            this.ignoreDeadStatements(block.statements).map(s => this.printStatement(s))
        );
    }

    private printStatement(statement: tstl.Statement): SourceNode {
        switch (statement.kind) {
            case tstl.SyntaxKind.DoStatement:
                return this.printDoStatement(statement as tstl.DoStatement);
            case tstl.SyntaxKind.VariableDeclarationStatement:
                return this.printVariableDeclarationStatement(statement as tstl.VariableDeclarationStatement);
            case tstl.SyntaxKind.AssignmentStatement:
                return this.printVariableAssignmentStatement(statement as tstl.AssignmentStatement);
            case tstl.SyntaxKind.IfStatement:
                return this.printIfStatement(statement as tstl.IfStatement);
            case tstl.SyntaxKind.WhileStatement:
                return this.printWhileStatement(statement as tstl.WhileStatement);
            case tstl.SyntaxKind.RepeatStatement:
                return this.printRepeatStatement(statement as tstl.RepeatStatement);
            case tstl.SyntaxKind.ForStatement:
                return this.printForStatement(statement as tstl.ForStatement);
            case tstl.SyntaxKind.ForInStatement:
                return this.printForInStatement(statement as tstl.ForInStatement);
            case tstl.SyntaxKind.GotoStatement:
                return this.printGotoStatement(statement as tstl.GotoStatement);
            case tstl.SyntaxKind.LabelStatement:
                return this.printLabelStatement(statement as tstl.LabelStatement);
            case tstl.SyntaxKind.ReturnStatement:
                return this.printReturnStatement(statement as tstl.ReturnStatement);
            case tstl.SyntaxKind.BreakStatement:
                return this.printBreakStatement(statement as tstl.BreakStatement);
            case tstl.SyntaxKind.ExpressionStatement:
                return this.printExpressionStatement(statement as tstl.ExpressionStatement);
            default:
                throw new Error(`Tried to print unknown statement kind: ${tstl.SyntaxKind[statement.kind]}`);
        }
    }

    private printDoStatement(statement: tstl.DoStatement): SourceNode {
        const chunks: SourceChunk[] = [];

        if (statement.statements && statement.statements.length > 0) {
            chunks.push(this.indent("do\n"));
            this.pushIndent();
            chunks.push(...this.ignoreDeadStatements(statement.statements).map(s => this.printStatement(s)));
            this.popIndent();
            chunks.push(this.indent("end\n"));
        }

        return this.concatNodes(...chunks);
    }

    private printVariableDeclarationStatement(statement: tstl.VariableDeclarationStatement): SourceNode {
        const chunks: SourceChunk[] = [];

        chunks.push(this.indent("local "));

        if (tstl.isFunctionDefinition(statement)) {
            const name = this.printExpression(statement.left[0]);
            chunks.push(this.printFunctionExpression(statement.right[0], name));
            chunks.push("\n");

        } else {
            chunks.push(...this.joinChunks(", ", statement.left.map(e => this.printExpression(e))));

            if (statement.right) {
                chunks.push(" = ");
                chunks.push(...this.joinChunks(", ", statement.right.map(e => this.printExpression(e))));
            }
            chunks.push(";\n");
        }

        return this.concatNodes(...chunks);
    }

    private printVariableAssignmentStatement(statement: tstl.AssignmentStatement): SourceNode {
        const chunks: SourceChunk[] = [];

        chunks.push(this.indent());

        if (tstl.isFunctionDefinition(statement)
            && (statement.right[0].flags & tstl.FunctionExpressionFlags.Declaration) !== 0)
        {
            const name = this.printExpression(statement.left[0]);
            if (tsHelper.isValidLuaFunctionDeclarationName(name.toString())) {
                chunks.push(this.printFunctionExpression(statement.right[0], name));
                chunks.push("\n");
                return this.createSourceNode(statement, chunks);
            }
        }

        chunks.push(...this.joinChunks(", ", statement.left.map(e => this.printExpression(e))));
        chunks.push(" = ");
        chunks.push(...this.joinChunks(", ", statement.right.map(e => this.printExpression(e))));
        chunks.push(";\n");

        return this.createSourceNode(statement, chunks);
    }

    private printIfStatement(statement: tstl.IfStatement, isElseIf?: boolean): SourceNode {
        const chunks: SourceChunk[] = [];

        const prefix = isElseIf ? "elseif" : "if";

        chunks.push(this.indent(prefix + " "), this.printExpression(statement.condtion), " then\n");

        this.pushIndent();
        chunks.push(this.printBlock(statement.ifBlock));
        this.popIndent();

        if (statement.elseBlock) {
            if (tstl.isIfStatement(statement.elseBlock)) {
                chunks.push(this.printIfStatement(statement.elseBlock, true));
            } else {
                chunks.push(this.indent("else\n"));
                this.pushIndent();
                chunks.push(this.printBlock(statement.elseBlock));
                this.popIndent();
                chunks.push(this.indent("end\n"));
            }
        } else {
            chunks.push(this.indent("end\n"));
        }

        return this.concatNodes(...chunks);
    }

    private printWhileStatement(statement: tstl.WhileStatement): SourceNode {
        const chunks: SourceChunk[] = [];

        chunks.push(this.indent("while "), this.printExpression(statement.condtion), " do\n");

        this.pushIndent();
        chunks.push(this.printBlock(statement.body));
        this.popIndent();

        chunks.push(this.indent("end\n"));

        return this.concatNodes(...chunks);
    }

    private printRepeatStatement(statement: tstl.RepeatStatement): SourceNode {
        const chunks: SourceChunk[] = [];

        chunks.push(this.indent(`repeat\n`));

        this.pushIndent();
        chunks.push(this.printBlock(statement.body));
        this.popIndent();

        chunks.push(this.indent("until "), this.printExpression(statement.condtion), ";\n");

        return this.concatNodes(...chunks);
    }

    private printForStatement(statement: tstl.ForStatement): SourceNode {
        const ctrlVar = this.printExpression(statement.controlVariable);
        const ctrlVarInit = this.printExpression(statement.controlVariableInitializer);
        const limit = this.printExpression(statement.limitExpression);

        const chunks: SourceChunk[] = [];

        chunks.push(this.indent("for "), ctrlVar, " = ", ctrlVarInit, ", ", limit);

        if (statement.stepExpression) {
            chunks.push(", ", this.printExpression(statement.stepExpression));
        }
        chunks.push(" do\n");

        this.pushIndent();
        chunks.push(this.printBlock(statement.body));
        this.popIndent();

        chunks.push(this.indent("end\n"));

        return this.concatNodes(...chunks);
    }

    private printForInStatement(statement: tstl.ForInStatement): SourceNode {
        const names = statement.names.map(i => this.printIdentifier(i)).join(", ");
        const expressions = statement.expressions.map(e => this.printExpression(e)).join(", ");

        const chunks: SourceChunk[] = [];

        chunks.push(this.indent("for "), names, " in ", expressions, " do\n");

        this.pushIndent();
        chunks.push(this.printBlock(statement.body));
        this.popIndent();
        chunks.push(this.indent("end\n"));

        return this.createSourceNode(statement, chunks);
    }

    private printGotoStatement(statement: tstl.GotoStatement): SourceNode {
        return this.createSourceNode(statement, [this.indent("goto "), statement.label, ";\n"]);
    }

    private printLabelStatement(statement: tstl.LabelStatement): SourceNode {
        return this.createSourceNode(statement, [this.indent("::"), statement.name, "::\n"]);
    }

    private printReturnStatement(statement: tstl.ReturnStatement, inline?: boolean): SourceNode {
        if (!statement.expressions || statement.expressions.length === 0) {
            const ret = inline ? "return;" : this.indent("return;\n");
            return this.createSourceNode(statement, ret);
        }

        const chunks: SourceChunk[] = [];

        chunks.push("return ");
        chunks.push(...this.joinChunks(", ", statement.expressions.map(e => this.printExpression(e))));
        chunks.push(";");

        if (!inline) {
            chunks.unshift(this.indent());
            chunks.push("\n");
        }

        return this.createSourceNode(statement, chunks);
    }

    private printBreakStatement(statement: tstl.BreakStatement): SourceNode {
        return this.createSourceNode(statement, this.indent("break;\n"));
    }

    private printExpressionStatement(statement: tstl.ExpressionStatement): SourceNode {
        return this.concatNodes(this.indent(), this.printExpression(statement.expression), ";\n");
    }

    // Expressions
    private printExpression(expression: tstl.Expression): SourceNode {
        switch (expression.kind) {
            case tstl.SyntaxKind.StringLiteral:
                return this.printStringLiteral(expression as tstl.StringLiteral);
            case tstl.SyntaxKind.NumericLiteral:
                return this.printNumericLiteral(expression as tstl.NumericLiteral);
            case tstl.SyntaxKind.NilKeyword:
                return this.printNilLiteral(expression as tstl.NilLiteral);
            case tstl.SyntaxKind.DotsKeyword:
                return this.printDotsLiteral(expression as tstl.DotsLiteral);
            case tstl.SyntaxKind.TrueKeyword:
            case tstl.SyntaxKind.FalseKeyword:
                return this.printBooleanLiteral(expression as tstl.BooleanLiteral);
            case tstl.SyntaxKind.FunctionExpression:
                return this.printFunctionExpression(expression as tstl.FunctionExpression);
            case tstl.SyntaxKind.TableFieldExpression:
                return this.printTableFieldExpression(expression as tstl.TableFieldExpression);
            case tstl.SyntaxKind.TableExpression:
                return this.printTableExpression(expression as tstl.TableExpression);
            case tstl.SyntaxKind.UnaryExpression:
                return this.printUnaryExpression(expression as tstl.UnaryExpression);
            case tstl.SyntaxKind.BinaryExpression:
                return this.printBinaryExpression(expression as tstl.BinaryExpression);
            case tstl.SyntaxKind.ParenthesizedExpression:
                return this.printParenthesizedExpression(expression as tstl.ParenthesizedExpression);
            case tstl.SyntaxKind.CallExpression:
                return this.printCallExpression(expression as tstl.CallExpression);
            case tstl.SyntaxKind.MethodCallExpression:
                return this.printMethodCallExpression(expression as tstl.MethodCallExpression);
            case tstl.SyntaxKind.Identifier:
                return this.printIdentifier(expression as tstl.Identifier);
            case tstl.SyntaxKind.TableIndexExpression:
                return this.printTableIndexExpression(expression as tstl.TableIndexExpression);
            default:
                throw new Error(`Tried to print unknown statement kind: ${tstl.SyntaxKind[expression.kind]}`);
        }
    }

    private printStringLiteral(expression: tstl.StringLiteral): SourceNode {
        return this.createSourceNode(expression, `"${expression.value}"`);
    }

    private printNumericLiteral(expression: tstl.NumericLiteral): SourceNode {
        return this.createSourceNode(expression, String(expression.value));
    }

    private printNilLiteral(expression: tstl.NilLiteral): SourceNode {
        return this.createSourceNode(expression, "nil");
    }

    private printDotsLiteral(expression: tstl.DotsLiteral): SourceNode {
        return this.createSourceNode(expression, "...");
    }

    private printBooleanLiteral(expression: tstl.BooleanLiteral): SourceNode {
        if (expression.kind === tstl.SyntaxKind.TrueKeyword) {
            return this.createSourceNode(expression, "true");
        } else {
            return this.createSourceNode(expression, "false");
        }
    }

    private printFunctionExpression(expression: tstl.FunctionExpression, name?: SourceChunk): SourceNode {
        const parameterChunks: SourceNode[] = expression.params
            ? expression.params.map(i => this.printIdentifier(i))
            : [];

        if (expression.dots) {
            parameterChunks.push(this.printDotsLiteral(expression.dots));
        }

        const chunks: SourceChunk[] = [];

        chunks.push("function");

        if (name) {
            chunks.push(" ");
            chunks.push(name);
        }

        chunks.push("(");
        chunks.push(...this.joinChunks(", ", parameterChunks));
        chunks.push(")");

        if (expression.body.statements
            && expression.body.statements.length === 1
            && tstl.isReturnStatement(expression.body.statements[0])
            && (expression.flags & tstl.FunctionExpressionFlags.Inline) !== 0)
        {
            chunks.push(" ");
            chunks.push(this.printReturnStatement(expression.body.statements[0] as tstl.ReturnStatement, true));
            chunks.push(" end");

        } else {
            chunks.push("\n");
            this.pushIndent();
            chunks.push(this.printBlock(expression.body));
            this.popIndent();
            chunks.push(this.indent("end"));
        }

        return this.createSourceNode(expression, chunks);
    }

    private printTableFieldExpression(expression: tstl.TableFieldExpression): SourceNode {
        const chunks: SourceChunk[] = [];

        const value = this.printExpression(expression.value);

        if (expression.key) {
            if (tstl.isStringLiteral(expression.key) && tsHelper.isValidLuaIdentifier(expression.key.value)) {
                chunks.push(expression.key.value, " = ", value);
            } else {
                chunks.push("[", this.printExpression(expression.key), "] = ", value);
            }
        } else {
            chunks.push(value);
        }

        return this.createSourceNode(expression, chunks);
    }

    private printTableExpression(expression: tstl.TableExpression): SourceNode {
        const chunks: SourceChunk[] = [];

        chunks.push("{");

        if (expression.fields) {
            expression.fields.forEach((f, i) => {
                if (i < expression.fields.length - 1) {
                    chunks.push(this.printTableFieldExpression(f), ", ");
                } else {
                    chunks.push(this.printTableFieldExpression(f));
                }
            });
        }

        chunks.push("}");

        return this.createSourceNode(expression, chunks);
    }

    private printUnaryExpression(expression: tstl.UnaryExpression): SourceNode {
        const chunks: SourceChunk[] = [];

        chunks.push(this.printOperator(expression.operator));
        chunks.push(this.printExpression(expression.operand));

        return this.createSourceNode(expression, chunks);
    }

    private printBinaryExpression(expression: tstl.BinaryExpression): SourceNode {
        const chunks: SourceChunk[] = [];

        chunks.push(this.printExpression(expression.left));
        chunks.push(" ", this.printOperator(expression.operator), " ");
        chunks.push(this.printExpression(expression.right));

        return this.createSourceNode(expression, chunks);
    }

    private printParenthesizedExpression(expression: tstl.ParenthesizedExpression): SourceNode {
        return this.createSourceNode(expression, ["(", this.printExpression(expression.innerEpxression), ")"]);
    }

    private printCallExpression(expression: tstl.CallExpression): SourceNode {
        const chunks = [];
        const parameterChunks = this.joinChunks(", ", expression.params.map(e => this.printExpression(e)));

        chunks.push(this.printExpression(expression.expression), "(", ...parameterChunks, ")");

        return this.concatNodes(...chunks);
    }

    private printMethodCallExpression(expression: tstl.MethodCallExpression): SourceNode {
        const prefix = this.printExpression(expression.prefixExpression);
        const parameterChunks = this.joinChunks(", ", expression.params.map(e => this.printExpression(e)));
        const name = this.printIdentifier(expression.name);

        return this.concatNodes(prefix, ":", name, "(", ...parameterChunks, ")");
    }

    private printIdentifier(expression: tstl.Identifier): SourceNode {
        return this.createSourceNode(expression, expression.text);
    }

    private printTableIndexExpression(expression: tstl.TableIndexExpression): SourceNode {
        const chunks: SourceChunk[] = [];

        chunks.push(this.printExpression(expression.table));
        if (tstl.isStringLiteral(expression.index) && tsHelper.isValidLuaIdentifier(expression.index.value)) {
            chunks.push(".", this.createSourceNode(expression.index, expression.index.value));
        } else {
            chunks.push("[", this.printExpression(expression.index), "]");
        }
        return this.createSourceNode(expression, chunks);
    }

    private printOperator(kind: tstl.Operator): string {
        return LuaPrinter.operatorMap[kind];
    }

    private ignoreDeadStatements(statements: tstl.Statement[]): tstl.Statement[] {
        const aliveStatements = [];
        for (const statement of statements) {
            aliveStatements.push(statement);
            if (tstl.isReturnStatement(statement)) {
                break;
            }
        }
        return aliveStatements;
    }

    private joinChunks(separator: string, chunks: SourceChunk[]): SourceChunk[] {
        const result = [];
        for (let i = 0; i < chunks.length; i++) {
            result.push(chunks[i]);
            if (i < chunks.length - 1) {
                result.push(separator);
            }
        }
        return result;
    }
}
