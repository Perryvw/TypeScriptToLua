import * as ts from "typescript";
import { LuaTarget } from "../../CompilerOptions";
import * as lua from "../../LuaAST";
import { assert, castArray } from "../../utils";
import { TransformationContext } from "../context";
import { createExportedIdentifier, getIdentifierExportScope } from "./export";
import { peekScope, ScopeType, Scope, addScopeVariableDeclaration } from "./scope";
import { transformLuaLibFunction } from "./lualib";
import { LuaLibFeature } from "../../LuaLib";

export type OneToManyVisitorResult<T extends lua.Node> = T | T[] | undefined;
export function unwrapVisitorResult<T extends lua.Node>(result: OneToManyVisitorResult<T>): T[] {
    return result === undefined ? [] : castArray(result);
}

export function createSelfIdentifier(tsOriginal?: ts.Node): lua.Identifier {
    return lua.createIdentifier("self", tsOriginal, undefined, "this");
}

export function createExportsIdentifier(): lua.Identifier {
    return lua.createIdentifier("____exports");
}

export function addToNumericExpression(expression: lua.Expression, change: number): lua.Expression {
    if (change === 0) return expression;

    const literalValue = getNumberLiteralValue(expression);
    if (literalValue !== undefined) {
        const newNode = lua.createNumericLiteral(literalValue + change);
        lua.setNodePosition(newNode, expression);
        return newNode;
    }

    if (lua.isBinaryExpression(expression)) {
        if (
            lua.isNumericLiteral(expression.right) &&
            ((expression.operator === lua.SyntaxKind.SubtractionOperator && expression.right.value === change) ||
                (expression.operator === lua.SyntaxKind.AdditionOperator && expression.right.value === -change))
        ) {
            return expression.left;
        }
    }

    return change > 0
        ? lua.createBinaryExpression(expression, lua.createNumericLiteral(change), lua.SyntaxKind.AdditionOperator)
        : lua.createBinaryExpression(expression, lua.createNumericLiteral(-change), lua.SyntaxKind.SubtractionOperator);
}

export function getNumberLiteralValue(expression?: lua.Expression) {
    if (!expression) return undefined;

    if (lua.isNumericLiteral(expression)) return expression.value;

    if (
        lua.isUnaryExpression(expression) &&
        expression.operator === lua.SyntaxKind.NegationOperator &&
        lua.isNumericLiteral(expression.operand)
    ) {
        return -expression.operand.value;
    }

    return undefined;
}

export function createUnpackCall(
    context: TransformationContext,
    expression: lua.Expression,
    tsOriginal?: ts.Node
): lua.Expression {
    if (context.luaTarget === LuaTarget.Universal) {
        return transformLuaLibFunction(context, LuaLibFeature.Unpack, tsOriginal, expression);
    }

    const unpack =
        context.luaTarget === LuaTarget.Lua51 || context.luaTarget === LuaTarget.LuaJIT
            ? lua.createIdentifier("unpack")
            : lua.createTableIndexExpression(lua.createIdentifier("table"), lua.createStringLiteral("unpack"));

    return lua.createCallExpression(unpack, [expression], tsOriginal);
}

export function wrapInTable(...expressions: lua.Expression[]): lua.TableExpression {
    const fields = expressions.map(e => lua.createTableFieldExpression(e));
    return lua.createTableExpression(fields);
}

export function wrapInToStringForConcat(expression: lua.Expression): lua.Expression {
    if (
        lua.isStringLiteral(expression) ||
        lua.isNumericLiteral(expression) ||
        (lua.isBinaryExpression(expression) && expression.operator === lua.SyntaxKind.ConcatOperator)
    ) {
        return expression;
    }

    return lua.createCallExpression(lua.createIdentifier("tostring"), [expression]);
}

export function createHoistableVariableDeclarationStatement(
    context: TransformationContext,
    identifier: lua.Identifier,
    initializer?: lua.Expression,
    tsOriginal?: ts.Node
): lua.AssignmentStatement | lua.VariableDeclarationStatement {
    const declaration = lua.createVariableDeclarationStatement(identifier, initializer, tsOriginal);
    if (identifier.symbolId !== undefined) {
        const scope = peekScope(context);
        assert(scope.type !== ScopeType.Switch);
        addScopeVariableDeclaration(scope, declaration);
    }

    return declaration;
}

function hasMultipleReferences(scope: Scope, identifiers: lua.Identifier | lua.Identifier[]) {
    const scopeSymbols = scope.referencedSymbols;
    if (!scopeSymbols) {
        return false;
    }

    const referenceLists = castArray(identifiers).map(i => i.symbolId && scopeSymbols.get(i.symbolId));

    return referenceLists.some(symbolRefs => symbolRefs && symbolRefs.length > 1);
}

export function createLocalOrExportedOrGlobalDeclaration(
    context: TransformationContext,
    lhs: lua.Identifier | lua.Identifier[],
    rhs?: lua.Expression | lua.Expression[],
    tsOriginal?: ts.Node,
    overrideExportScope?: ts.SourceFile | ts.ModuleDeclaration
): lua.Statement[] {
    let declaration: lua.VariableDeclarationStatement | undefined;
    let assignment: lua.AssignmentStatement | undefined;

    const isFunctionDeclaration = tsOriginal !== undefined && ts.isFunctionDeclaration(tsOriginal);

    const identifiers = castArray(lhs);
    if (identifiers.length === 0) {
        return [];
    }

    const exportScope = overrideExportScope ?? getIdentifierExportScope(context, identifiers[0]);
    if (exportScope) {
        // exported
        if (!rhs) {
            return [];
        } else {
            assignment = lua.createAssignmentStatement(
                identifiers.map(identifier => createExportedIdentifier(context, identifier, exportScope)),
                rhs,
                tsOriginal
            );
        }
    } else {
        const scope = peekScope(context);
        const isTopLevelVariable = scope.type === ScopeType.File;

        if (context.isModule || !isTopLevelVariable) {
            if (!isFunctionDeclaration && hasMultipleReferences(scope, lhs)) {
                // Split declaration and assignment of identifiers that reference themselves in their declaration.
                // Put declaration above preceding statements in case the identifier is referenced in those.
                const precedingDeclaration = lua.createVariableDeclarationStatement(lhs, undefined, tsOriginal);
                context.addPrecedingStatements([precedingDeclaration], true);
                if (rhs) {
                    assignment = lua.createAssignmentStatement(lhs, rhs, tsOriginal);
                }

                if (!isFunctionDeclaration) {
                    // Remember local variable declarations for hoisting later
                    addScopeVariableDeclaration(scope, precedingDeclaration);
                }
            } else {
                declaration = lua.createVariableDeclarationStatement(lhs, rhs, tsOriginal);

                if (!isFunctionDeclaration) {
                    // Remember local variable declarations for hoisting later
                    addScopeVariableDeclaration(scope, declaration);
                }
            }
        } else if (rhs) {
            // global
            assignment = lua.createAssignmentStatement(lhs, rhs, tsOriginal);
        } else {
            return [];
        }
    }

    if (isFunctionDeclaration) {
        // Remember function definitions for hoisting later
        const functionSymbolId = (lhs as lua.Identifier).symbolId;
        const scope = peekScope(context);
        if (functionSymbolId && scope.functionDefinitions) {
            const definitions = scope.functionDefinitions.get(functionSymbolId);
            if (definitions) {
                definitions.definition = declaration ?? assignment;
            }
        }
    }

    if (declaration && assignment) {
        return [declaration, assignment];
    } else if (declaration) {
        return [declaration];
    } else if (assignment) {
        return [assignment];
    } else {
        return [];
    }
}

export const createNaN = (tsOriginal?: ts.Node) =>
    lua.createBinaryExpression(
        lua.createNumericLiteral(0),
        lua.createNumericLiteral(0),
        lua.SyntaxKind.DivisionOperator,
        tsOriginal
    );
