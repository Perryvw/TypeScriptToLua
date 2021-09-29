import * as ts from "typescript";
import { CompilerOptions, LuaTarget } from "../../CompilerOptions";
import * as lua from "../../LuaAST";
import { assert, castArray } from "../../utils";
import { unsupportedNodeKind } from "../utils/diagnostics";
import { unwrapVisitorResult } from "../utils/lua-ast";
import { fixInvalidLuaIdentifier, isValidLuaIdentifier } from "../utils/safe-names";
import { ExpressionLikeNode, ObjectVisitor, StatementLikeNode, VisitorMap } from "./visitors";

export interface AllAccessorDeclarations {
    firstAccessor: ts.AccessorDeclaration;
    secondAccessor: ts.AccessorDeclaration | undefined;
    getAccessor: ts.GetAccessorDeclaration | undefined;
    setAccessor: ts.SetAccessorDeclaration | undefined;
}

export interface EmitResolver {
    isValueAliasDeclaration(node: ts.Node): boolean;
    isReferencedAliasDeclaration(node: ts.Node, checkChildren?: boolean): boolean;
    isTopLevelValueImportEqualsWithEntityName(node: ts.ImportEqualsDeclaration): boolean;
    moduleExportsSomeValue(moduleReferenceExpression: ts.Expression): boolean;
    getAllAccessorDeclarations(declaration: ts.AccessorDeclaration): AllAccessorDeclarations;
}

export interface DiagnosticsProducingTypeChecker extends ts.TypeChecker {
    getEmitResolver(sourceFile?: ts.SourceFile, cancellationToken?: ts.CancellationToken): EmitResolver;
}

export class TransformationContext {
    public readonly diagnostics: ts.Diagnostic[] = [];
    public readonly checker: DiagnosticsProducingTypeChecker = this.program.getDiagnosticsProducingTypeChecker();
    public readonly resolver: EmitResolver;
    public readonly precedingStatementsStack: lua.Statement[][] = [];

    public readonly options: CompilerOptions = this.program.getCompilerOptions();
    public readonly luaTarget = this.options.luaTarget ?? LuaTarget.Universal;
    public readonly isModule = ts.isExternalModule(this.sourceFile);
    public readonly isStrict =
        (this.options.alwaysStrict ?? this.options.strict) ||
        (this.isModule && this.options.target !== undefined && this.options.target >= ts.ScriptTarget.ES2015);

    constructor(public program: ts.Program, public sourceFile: ts.SourceFile, private visitorMap: VisitorMap) {
        // Use `getParseTreeNode` to get original SourceFile node, before it was substituted by custom transformers.
        // It's required because otherwise `getEmitResolver` won't use cached diagnostics, produced in `emitWorker`
        // and would try to re-analyze the file, which would fail because of replaced nodes.
        const originalSourceFile = ts.getParseTreeNode(sourceFile, ts.isSourceFile) ?? sourceFile;
        this.resolver = this.checker.getEmitResolver(originalSourceFile);
    }

    private currentNodeVisitors: Array<ObjectVisitor<ts.Node>> = [];
    private nextTempId = 0;

    public transformNode(node: ts.Node): lua.Node[];
    /** @internal */
    // eslint-disable-next-line @typescript-eslint/unified-signatures
    public transformNode(node: ts.Node, isExpression?: boolean): lua.Node[];
    public transformNode(node: ts.Node, isExpression?: boolean): lua.Node[] {
        // TODO: Move to visitors?
        if (node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)) {
            return [];
        }

        const nodeVisitors = this.visitorMap.get(node.kind);
        if (!nodeVisitors || nodeVisitors.length === 0) {
            this.diagnostics.push(unsupportedNodeKind(node, node.kind));
            return isExpression ? [lua.createNilLiteral()] : [];
        }

        const previousNodeVisitors = this.currentNodeVisitors;
        this.currentNodeVisitors = [...nodeVisitors];

        const visitor = this.currentNodeVisitors.pop()!;
        const result = unwrapVisitorResult(visitor.transform(node, this));

        this.currentNodeVisitors = previousNodeVisitors;

        return result;
    }

    public superTransformNode(node: ts.Node): lua.Node[] {
        if (this.currentNodeVisitors.length === 0) {
            throw new Error(`There is no super transform for ${ts.SyntaxKind[node.kind]} visitor`);
        }

        const visitor = this.currentNodeVisitors.pop()!;
        return unwrapVisitorResult(visitor.transform(node, this));
    }

    public transformExpression(node: ExpressionLikeNode): lua.Expression {
        const [result] = this.transformNode(node, true);

        if (result === undefined) {
            throw new Error(`Expression visitor for node type ${ts.SyntaxKind[node.kind]} did not return any result.`);
        }

        return result as lua.Expression;
    }

    public superTransformExpression(node: ExpressionLikeNode): lua.Expression {
        const [result] = this.superTransformNode(node);

        if (result === undefined) {
            throw new Error(`Expression visitor for node type ${ts.SyntaxKind[node.kind]} did not return any result.`);
        }

        return result as lua.Expression;
    }

    public transformStatements(node: StatementLikeNode | readonly StatementLikeNode[]): lua.Statement[] {
        return castArray(node).flatMap(n => {
            this.pushPrecedingStatements();
            const statements = this.transformNode(n) as lua.Statement[];
            statements.unshift(...this.popPrecedingStatements());
            return statements;
        });
    }

    public superTransformStatements(node: StatementLikeNode | readonly StatementLikeNode[]): lua.Statement[] {
        return castArray(node).flatMap(n => {
            this.pushPrecedingStatements();
            const statements = this.superTransformNode(n) as lua.Statement[];
            statements.unshift(...this.popPrecedingStatements());
            return statements;
        });
    }

    public pushPrecedingStatements() {
        this.precedingStatementsStack.push([]);
    }

    public popPrecedingStatements() {
        const precedingStatements = this.precedingStatementsStack.pop();
        assert(precedingStatements);
        return precedingStatements;
    }

    public addPrecedingStatements(statements: lua.Statement | lua.Statement[], prepend = false) {
        const precedingStatements = this.precedingStatementsStack[this.precedingStatementsStack.length - 1];
        assert(precedingStatements);
        if (!Array.isArray(statements)) {
            statements = [statements];
        }
        if (prepend) {
            precedingStatements.unshift(...statements);
        } else {
            precedingStatements.push(...statements);
        }
    }

    public createTempName(prefix = "temp") {
        return `____${prefix}_${this.nextTempId++}`;
    }

    private getTempNameForLuaExpression(expression: lua.Expression): string | undefined {
        let name: string | undefined;
        if (lua.isStringLiteral(expression) || lua.isNumericLiteral(expression)) {
            name = expression.value.toString();
        } else if (lua.isIdentifier(expression)) {
            name = expression.text;
        } else if (lua.isCallExpression(expression)) {
            name = this.getTempNameForLuaExpression(expression.expression);
            if (name) {
                name = `${name}_result`;
            }
        } else if (lua.isTableIndexExpression(expression)) {
            const tableName = this.getTempNameForLuaExpression(expression.table);
            const indexName = this.getTempNameForLuaExpression(expression.index);
            if (tableName || indexName) {
                name = `${tableName ?? "table"}_${indexName ?? "index"}`;
            }
        }
        if (name && !isValidLuaIdentifier(name)) {
            name = fixInvalidLuaIdentifier(name);
        }
        return name;
    }

    public createTempForLuaExpression(expression: lua.Expression) {
        const name = this.getTempNameForLuaExpression(expression);
        const identifier = lua.createIdentifier(this.createTempName(name));
        lua.setNodePosition(identifier, lua.getOriginalPos(expression));
        return identifier;
    }

    private getTempNameForNode(node: ts.Node): string | undefined {
        let name: string | undefined;
        if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isIdentifier(node) || ts.isMemberName(node)) {
            name = node.text;
        } else if (ts.isCallExpression(node)) {
            name = this.getTempNameForNode(node.expression);
            if (name) {
                name = `${name}_result`;
            }
        } else if (ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) {
            const tableName = this.getTempNameForNode(node.expression);
            const indexName = ts.isElementAccessExpression(node)
                ? this.getTempNameForNode(node.argumentExpression)
                : node.name.text;
            if (tableName || indexName) {
                name = `${tableName ?? "table"}_${indexName ?? "index"}`;
            }
        }
        if (name && !isValidLuaIdentifier(name)) {
            name = fixInvalidLuaIdentifier(name);
        }
        return name;
    }

    public createTempForNode(node: ts.Node) {
        const name = this.getTempNameForNode(node);
        return lua.createIdentifier(this.createTempName(name), node);
    }
}
