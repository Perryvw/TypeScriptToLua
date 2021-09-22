import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { assert, assertNever } from "../../utils";
import { FunctionVisitor, TransformationContext } from "../context";
import { validateAssignment } from "../utils/assignment-validation";
import { unsupportedVarDeclaration } from "../utils/diagnostics";
import { addExportToIdentifier } from "../utils/export";
import { createLocalOrExportedOrGlobalDeclaration, createUnpackCall, wrapInTable } from "../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { transformIdentifier } from "./identifier";
import { isMultiReturnCall } from "./language-extensions/multi";
import { transformPropertyName } from "./literal";

export function transformArrayBindingElement(
    context: TransformationContext,
    name: ts.ArrayBindingElement
): lua.Identifier {
    if (ts.isOmittedExpression(name)) {
        return lua.createAnonymousIdentifier(name);
    } else if (ts.isIdentifier(name)) {
        return transformIdentifier(context, name);
    } else if (ts.isBindingElement(name)) {
        // TODO: It should always be true when called from `transformVariableDeclaration`,
        // but could be false from `transformForOfLuaIteratorStatement`.
        assert(ts.isIdentifier(name.name));
        return transformIdentifier(context, name.name);
    } else {
        assertNever(name);
    }
}

export function transformBindingPattern(
    context: TransformationContext,
    pattern: ts.BindingPattern,
    table: lua.Identifier,
    propertyAccessStack: ts.PropertyName[] = []
): lua.Statement[] {
    const result: lua.Statement[] = [];

    for (const [index, element] of pattern.elements.entries()) {
        if (ts.isOmittedExpression(element)) continue;

        if (ts.isArrayBindingPattern(element.name) || ts.isObjectBindingPattern(element.name)) {
            // nested binding pattern
            const propertyName = ts.isObjectBindingPattern(pattern)
                ? element.propertyName
                : ts.factory.createNumericLiteral(String(index + 1));

            if (propertyName !== undefined) {
                propertyAccessStack.push(propertyName);
            }

            result.push(...transformBindingPattern(context, element.name, table, propertyAccessStack));
            continue;
        }

        // Build the path to the table
        const tableExpression = propertyAccessStack.reduce<lua.Expression>(
            (path, property) => lua.createTableIndexExpression(path, transformPropertyName(context, property)),
            table
        );

        // The identifier of the new variable
        const variableName = transformIdentifier(context, element.name);
        // The field to extract
        context.pushPrecedingStatements();
        const propertyName = transformPropertyName(context, element.propertyName ?? element.name);
        result.push(...context.popPrecedingStatements()); // Keep property's preceding statements in order

        let expression: lua.Expression;
        if (element.dotDotDotToken) {
            if (index !== pattern.elements.length - 1) {
                // TypeScript error
                continue;
            }

            if (ts.isObjectBindingPattern(pattern)) {
                const excludedProperties: ts.Identifier[] = [];

                for (const element of pattern.elements) {
                    // const { ...x } = ...;
                    //         ~~~~
                    if (element.dotDotDotToken) continue;

                    // const { x } = ...;
                    //         ~
                    if (ts.isIdentifier(element.name) && !element.propertyName) {
                        excludedProperties.push(element.name);
                    }

                    // const { x: ... } = ...;
                    //         ~~~~~~
                    if (element.propertyName && element.name && ts.isIdentifier(element.propertyName)) {
                        excludedProperties.push(element.propertyName);
                    }
                }

                const excludedPropertiesTable = excludedProperties.map(e =>
                    lua.createTableFieldExpression(lua.createBooleanLiteral(true), lua.createStringLiteral(e.text, e))
                );

                expression = transformLuaLibFunction(
                    context,
                    LuaLibFeature.ObjectRest,
                    undefined,
                    tableExpression,
                    lua.createTableExpression(excludedPropertiesTable)
                );
            } else {
                expression = transformLuaLibFunction(
                    context,
                    LuaLibFeature.ArraySlice,
                    undefined,
                    tableExpression,
                    lua.createNumericLiteral(index)
                );
            }
        } else {
            expression = lua.createTableIndexExpression(
                tableExpression,
                ts.isObjectBindingPattern(pattern) ? propertyName : lua.createNumericLiteral(index + 1)
            );
        }

        result.push(...createLocalOrExportedOrGlobalDeclaration(context, variableName, expression));
        if (element.initializer) {
            const identifier = addExportToIdentifier(context, variableName);
            context.pushPrecedingStatements();
            const initializer = context.transformExpression(element.initializer);
            const initializerPrecedingStatements = context.popPrecedingStatements();
            result.push(
                lua.createIfStatement(
                    lua.createBinaryExpression(identifier, lua.createNilLiteral(), lua.SyntaxKind.EqualityOperator),
                    lua.createBlock([
                        ...initializerPrecedingStatements,
                        lua.createAssignmentStatement(identifier, initializer),
                    ])
                )
            );
        }
    }

    propertyAccessStack.pop();
    return result;
}

export function transformBindingVariableDeclaration(
    context: TransformationContext,
    bindingPattern: ts.BindingPattern,
    initializer?: ts.Expression
): lua.Statement[] {
    const statements: lua.Statement[] = [];

    // For object, nested or rest bindings fall back to transformBindingPattern
    const isComplexBindingElement = (e: ts.ArrayBindingElement) =>
        ts.isBindingElement(e) && (!ts.isIdentifier(e.name) || e.dotDotDotToken);

    if (ts.isObjectBindingPattern(bindingPattern) || bindingPattern.elements.some(isComplexBindingElement)) {
        let table: lua.Identifier;
        if (initializer !== undefined && ts.isIdentifier(initializer)) {
            table = transformIdentifier(context, initializer);
        } else {
            // Contain the expression in a temporary variable
            if (initializer) {
                table = context.createTempForNode(initializer);
                let expression = context.transformExpression(initializer);
                if (isMultiReturnCall(context, initializer)) {
                    expression = wrapInTable(expression);
                }
                statements.push(lua.createVariableDeclarationStatement(table, expression));
            } else {
                table = lua.createAnonymousIdentifier();
            }
        }
        statements.push(...transformBindingPattern(context, bindingPattern, table));
        return statements;
    }

    const vars =
        bindingPattern.elements.length > 0
            ? bindingPattern.elements.map(e => transformArrayBindingElement(context, e))
            : lua.createAnonymousIdentifier();

    if (initializer) {
        if (isMultiReturnCall(context, initializer)) {
            // Don't unpack LuaMultiReturn functions
            statements.push(
                ...createLocalOrExportedOrGlobalDeclaration(
                    context,
                    vars,
                    context.transformExpression(initializer),
                    initializer
                )
            );
        } else if (ts.isArrayLiteralExpression(initializer)) {
            // Don't unpack array literals
            const values =
                initializer.elements.length > 0
                    ? initializer.elements.map(e => context.transformExpression(e))
                    : lua.createNilLiteral();
            statements.push(...createLocalOrExportedOrGlobalDeclaration(context, vars, values, initializer));
        } else {
            // local vars = this.transpileDestructingAssignmentValue(node.initializer);
            const unpackedInitializer = createUnpackCall(
                context,
                context.transformExpression(initializer),
                initializer
            );
            statements.push(
                ...createLocalOrExportedOrGlobalDeclaration(context, vars, unpackedInitializer, initializer)
            );
        }
    } else {
        statements.push(
            ...createLocalOrExportedOrGlobalDeclaration(context, vars, lua.createNilLiteral(), initializer)
        );
    }

    for (const element of bindingPattern.elements) {
        if (!ts.isOmittedExpression(element) && element.initializer) {
            const variableName = transformIdentifier(context, element.name as ts.Identifier);
            const identifier = addExportToIdentifier(context, variableName);
            statements.push(
                lua.createIfStatement(
                    lua.createBinaryExpression(identifier, lua.createNilLiteral(), lua.SyntaxKind.EqualityOperator),
                    lua.createBlock([
                        lua.createAssignmentStatement(identifier, context.transformExpression(element.initializer)),
                    ])
                )
            );
        }
    }

    return statements;
}

// TODO: FunctionVisitor<ts.VariableDeclaration>
export function transformVariableDeclaration(
    context: TransformationContext,
    statement: ts.VariableDeclaration
): lua.Statement[] {
    if (statement.initializer && statement.type) {
        const initializerType = context.checker.getTypeAtLocation(statement.initializer);
        const varType = context.checker.getTypeFromTypeNode(statement.type);
        validateAssignment(context, statement.initializer, initializerType, varType);
    }

    if (ts.isIdentifier(statement.name)) {
        // Find variable identifier
        const identifierName = transformIdentifier(context, statement.name);
        const value = statement.initializer && context.transformExpression(statement.initializer);
        return createLocalOrExportedOrGlobalDeclaration(context, identifierName, value, statement);
    } else if (ts.isArrayBindingPattern(statement.name) || ts.isObjectBindingPattern(statement.name)) {
        return transformBindingVariableDeclaration(context, statement.name, statement.initializer);
    } else {
        return assertNever(statement.name);
    }
}

export function checkVariableDeclarationList(context: TransformationContext, node: ts.VariableDeclarationList): void {
    if ((node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0) {
        const token = node.getFirstToken();
        assert(token);
        context.diagnostics.push(unsupportedVarDeclaration(token));
    }
}

export const transformVariableStatement: FunctionVisitor<ts.VariableStatement> = (node, context) => {
    checkVariableDeclarationList(context, node.declarationList);
    return node.declarationList.declarations.flatMap(declaration => transformVariableDeclaration(context, declaration));
};
