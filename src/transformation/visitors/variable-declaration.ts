import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { assert, assertNever } from "../../utils";
import { FunctionVisitor, TransformationContext } from "../context";
import { validateAssignment } from "../utils/assignment-validation";
import { unsupportedVarDeclaration } from "../utils/diagnostics";
import { addExportToIdentifier } from "../utils/export";
import { createLocalOrExportedOrGlobalDeclaration, createUnpackCall, wrapInTable } from "../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { transformInPrecedingStatementScope } from "../utils/preceding-statements";
import { createCallableTable, isFunctionTypeWithProperties } from "./function";
import { transformIdentifier } from "./identifier";
import { isMultiReturnCall } from "./language-extensions/multi";
import { transformPropertyName } from "./literal";
import { moveToPrecedingTemp } from "./expression-list";
import { isStringType } from "../utils/typescript";

export function transformArrayBindingElement(
    context: TransformationContext,
    name: ts.ArrayBindingElement
): lua.Identifier {
    if (ts.isOmittedExpression(name)) {
        return lua.createAnonymousIdentifier(name);
    } else if (ts.isIdentifier(name)) {
        return transformIdentifier(context, name);
    } else if (ts.isBindingElement(name)) {
        if (ts.isIdentifier(name.name)) {
            return transformIdentifier(context, name.name);
        } else {
            // ts.isBindingPattern(name.name)
            const tempName = context.createTempNameForNode(name.name);
            context.addPrecedingStatements(transformBindingPattern(context, name.name, tempName));
            return tempName;
        }
    } else {
        assertNever(name);
    }
}

export function transformBindingPattern(
    context: TransformationContext,
    pattern: ts.BindingPattern,
    table: lua.Expression,
    propertyAccessStack: ts.PropertyName[] = [],
    isStringBinding = false
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
        const elementName = element.propertyName ?? element.name;
        const { precedingStatements, result: propertyName } = transformInPrecedingStatementScope(context, () =>
            transformPropertyName(context, elementName)
        );
        result.push(...precedingStatements); // Keep property's preceding statements in order

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
            if (isStringBinding) {
                // don't add 1 to index stringaccess already takes care of that
                expression = transformLuaLibFunction(
                    context,
                    LuaLibFeature.StringAccess,
                    pattern,
                    table,
                    lua.createNumericLiteral(index)
                );
            } else {
                expression = lua.createTableIndexExpression(
                    tableExpression,
                    ts.isObjectBindingPattern(pattern) ? propertyName : lua.createNumericLiteral(index + 1)
                );
            }
        }

        result.push(...createLocalOrExportedOrGlobalDeclaration(context, variableName, expression));
        if (element.initializer) {
            const identifier = addExportToIdentifier(context, variableName);
            const tsInitializer = element.initializer;
            const { precedingStatements: initializerPrecedingStatements, result: initializer } =
                transformInPrecedingStatementScope(context, () => context.transformExpression(tsInitializer));
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

function requiresComplexBindingVariableDeclaration(
    context: TransformationContext,
    bindingPattern: ts.BindingPattern,
    initializer?: ts.Expression
): boolean {
    // For object, strings, nested or rest bindings fall back to transformBindingPattern
    const isComplexBindingElement = (e: ts.ArrayBindingElement) =>
        ts.isBindingElement(e) && (!ts.isIdentifier(e.name) || e.dotDotDotToken);

    const hasStringInitializer = initializer && isStringType(context, context.checker.getTypeAtLocation(initializer));

    return (
        ts.isObjectBindingPattern(bindingPattern) ||
        bindingPattern.elements.some(isComplexBindingElement) ||
        Boolean(hasStringInitializer)
    );
}
function transformComplexBindingVariableDeclaration(
    context: TransformationContext,
    bindingPattern: ts.BindingPattern,
    initializer?: ts.Expression
): lua.Statement[] {
    const statements: lua.Statement[] = [];

    let table: lua.Expression;
    if (initializer) {
        // Contain the expression in a temporary variable
        let expression = context.transformExpression(initializer);
        if (isMultiReturnCall(context, initializer)) {
            expression = wrapInTable(expression);
        }
        const { precedingStatements: moveStatements, result: movedExpr } = transformInPrecedingStatementScope(
            context,
            () => moveToPrecedingTemp(context, expression, initializer)
        );
        statements.push(...moveStatements);
        table = movedExpr;
    } else {
        table = lua.createAnonymousIdentifier();
    }
    statements.push(
        ...transformBindingPattern(
            context,
            bindingPattern,
            table,
            [],
            initializer && isStringType(context, context.checker.getTypeAtLocation(initializer))
        )
    );
    return statements;
}

export function transformBindingVariableDeclaration(
    context: TransformationContext,
    bindingPattern: ts.BindingPattern,
    initializer?: ts.Expression
): lua.Statement[] {
    const statements: lua.Statement[] = [];

    if (requiresComplexBindingVariableDeclaration(context, bindingPattern, initializer)) {
        return transformComplexBindingVariableDeclaration(context, bindingPattern, initializer);
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
        } else if (ts.isStringLiteral(initializer)) {
            const values =
                initializer.text.length > 0
                    ? Array.from(initializer.text).map(c => lua.createStringLiteral(c))
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

        // Wrap functions being assigned to a type that contains additional properties in a callable table
        // This catches 'const foo = function() {}; foo.bar = "FOOBAR";'
        const wrappedValue = value && shouldWrapInitializerInCallableTable() ? createCallableTable(value) : value;

        return createLocalOrExportedOrGlobalDeclaration(context, identifierName, wrappedValue, statement);
    } else if (ts.isArrayBindingPattern(statement.name) || ts.isObjectBindingPattern(statement.name)) {
        return transformBindingVariableDeclaration(context, statement.name, statement.initializer);
    } else {
        return assertNever(statement.name);
    }

    function shouldWrapInitializerInCallableTable() {
        assert(statement.initializer);
        const initializer = ts.skipOuterExpressions(statement.initializer);
        // do not wrap if not a function expression
        if (!ts.isFunctionExpression(initializer) && !ts.isArrowFunction(initializer)) return false;
        // Skip named function expressions because they will have been wrapped already
        if (ts.isFunctionExpression(initializer) && initializer.name) return false;
        return isFunctionTypeWithProperties(context, context.checker.getTypeAtLocation(statement.name));
    }
}

export function checkVariableDeclarationList(context: TransformationContext, node: ts.VariableDeclarationList): void {
    if ((node.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const | ts.NodeFlags.Using | ts.NodeFlags.AwaitUsing)) === 0) {
        const token = ts.getOriginalNode(node).getFirstToken();
        assert(token);
        context.diagnostics.push(unsupportedVarDeclaration(token));
    }
}

export const transformVariableStatement: FunctionVisitor<ts.VariableStatement> = (node, context) => {
    checkVariableDeclarationList(context, node.declarationList);
    return node.declarationList.declarations.flatMap(declaration => transformVariableDeclaration(context, declaration));
};
