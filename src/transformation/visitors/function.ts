import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { assert } from "../../utils";
import { FunctionVisitor, TransformationContext } from "../context";
import { AnnotationKind, getNodeAnnotations } from "../utils/annotations";
import { annotationRemoved } from "../utils/diagnostics";
import { createDefaultExportStringLiteral, hasDefaultExportModifier } from "../utils/export";
import { ContextType, getFunctionContextType } from "../utils/function-context";
import {
    createExportsIdentifier,
    createLocalOrExportedOrGlobalDeclaration,
    createSelfIdentifier,
    wrapInTable,
} from "../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { peekScope, performHoisting, popScope, pushScope, Scope, ScopeType } from "../utils/scope";
import { isAsyncFunction, wrapInAsyncAwaiter } from "./async-await";
import { transformIdentifier } from "./identifier";
import { transformExpressionBodyToReturnStatement } from "./return";
import { transformBindingPattern } from "./variable-declaration";

function transformParameterDefaultValueDeclaration(
    context: TransformationContext,
    parameterName: lua.Identifier,
    value?: ts.Expression,
    tsOriginal?: ts.Node
): lua.Statement {
    const parameterValue = value ? context.transformExpression(value) : undefined;
    const assignment = lua.createAssignmentStatement(parameterName, parameterValue);

    const nilCondition = lua.createBinaryExpression(
        parameterName,
        lua.createNilLiteral(),
        lua.SyntaxKind.EqualityOperator
    );

    const ifBlock = lua.createBlock([assignment]);

    return lua.createIfStatement(nilCondition, ifBlock, undefined, tsOriginal);
}

function isRestParameterReferenced(identifier: lua.Identifier, scope: Scope): boolean {
    if (!identifier.symbolId) {
        return true;
    }
    if (scope.referencedSymbols === undefined) {
        return false;
    }
    const references = scope.referencedSymbols.get(identifier.symbolId);
    return references !== undefined && references.length > 0;
}

export function transformFunctionBodyContent(context: TransformationContext, body: ts.ConciseBody): lua.Statement[] {
    if (!ts.isBlock(body)) {
        context.pushPrecedingStatements();
        const returnStatement = transformExpressionBodyToReturnStatement(context, body);
        const precedingStatements = context.popPrecedingStatements();
        return [...precedingStatements, returnStatement];
    }

    const bodyStatements = performHoisting(context, context.transformStatements(body.statements));
    return bodyStatements;
}

export function transformFunctionBodyHeader(
    context: TransformationContext,
    bodyScope: Scope,
    parameters: ts.NodeArray<ts.ParameterDeclaration>,
    spreadIdentifier?: lua.Identifier
): lua.Statement[] {
    const headerStatements = [];

    // Add default parameters and object binding patterns
    const bindingPatternDeclarations: lua.Statement[] = [];
    let bindPatternIndex = 0;
    for (const declaration of parameters) {
        if (ts.isObjectBindingPattern(declaration.name) || ts.isArrayBindingPattern(declaration.name)) {
            const identifier = lua.createIdentifier(`____bindingPattern${bindPatternIndex++}`);
            if (declaration.initializer !== undefined) {
                // Default binding parameter
                headerStatements.push(
                    transformParameterDefaultValueDeclaration(context, identifier, declaration.initializer)
                );
            }

            // Binding pattern
            bindingPatternDeclarations.push(...transformBindingPattern(context, declaration.name, identifier));
        } else if (declaration.initializer !== undefined) {
            // Default parameter
            headerStatements.push(
                transformParameterDefaultValueDeclaration(
                    context,
                    transformIdentifier(context, declaration.name),
                    declaration.initializer
                )
            );
        }
    }

    // Push spread operator here
    if (spreadIdentifier && isRestParameterReferenced(spreadIdentifier, bodyScope)) {
        const spreadTable = wrapInTable(lua.createDotsLiteral());
        headerStatements.push(lua.createVariableDeclarationStatement(spreadIdentifier, spreadTable));
    }

    // Binding pattern statements need to be after spread table is declared
    headerStatements.push(...bindingPatternDeclarations);

    return headerStatements;
}

export function transformFunctionBody(
    context: TransformationContext,
    parameters: ts.NodeArray<ts.ParameterDeclaration>,
    body: ts.ConciseBody,
    spreadIdentifier?: lua.Identifier,
    node?: ts.FunctionLikeDeclaration
): [lua.Statement[], Scope] {
    const scope = pushScope(context, ScopeType.Function);
    scope.node = node;
    let bodyStatements = transformFunctionBodyContent(context, body);
    if (node && isAsyncFunction(node)) {
        bodyStatements = wrapInAsyncAwaiter(context, bodyStatements);
    }
    const headerStatements = transformFunctionBodyHeader(context, scope, parameters, spreadIdentifier);
    popScope(context);
    return [[...headerStatements, ...bodyStatements], scope];
}

export function transformParameters(
    context: TransformationContext,
    parameters: ts.NodeArray<ts.ParameterDeclaration>,
    functionContext?: lua.Identifier
): [lua.Identifier[], lua.DotsLiteral | undefined, lua.Identifier | undefined] {
    // Build parameter string
    const paramNames: lua.Identifier[] = [];
    if (functionContext) {
        paramNames.push(functionContext);
    }

    let restParamName: lua.Identifier | undefined;
    let dotsLiteral: lua.DotsLiteral | undefined;
    let identifierIndex = 0;

    // Only push parameter name to paramName array if it isn't a spread parameter
    for (const param of parameters) {
        if (ts.isIdentifier(param.name) && param.name.originalKeywordKind === ts.SyntaxKind.ThisKeyword) {
            continue;
        }

        // Binding patterns become ____bindingPattern0, ____bindingPattern1, etc as function parameters
        // See transformFunctionBody for how these values are destructured
        const paramName =
            ts.isObjectBindingPattern(param.name) || ts.isArrayBindingPattern(param.name)
                ? lua.createIdentifier(`____bindingPattern${identifierIndex++}`)
                : transformIdentifier(context, param.name);

        // This parameter is a spread parameter (...param)
        if (!param.dotDotDotToken) {
            paramNames.push(paramName);
        } else {
            restParamName = paramName;
            // Push the spread operator into the paramNames array
            dotsLiteral = lua.createDotsLiteral();
        }
    }

    return [paramNames, dotsLiteral, restParamName];
}

export function transformFunctionToExpression(
    context: TransformationContext,
    node: ts.FunctionLikeDeclaration
): [lua.Expression, Scope] {
    assert(node.body);

    const type = context.checker.getTypeAtLocation(node);
    let functionContext: lua.Identifier | undefined;
    if (getFunctionContextType(context, type) !== ContextType.Void) {
        if (ts.isArrowFunction(node)) {
            // dummy context for arrow functions with parameters
            if (node.parameters.length > 0) {
                functionContext = lua.createAnonymousIdentifier();
            }
        } else {
            // self context
            functionContext = createSelfIdentifier();
        }
    }

    let flags = lua.FunctionExpressionFlags.None;
    if (!ts.isBlock(node.body)) flags |= lua.FunctionExpressionFlags.Inline;
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
        flags |= lua.FunctionExpressionFlags.Declaration;
    }

    const [paramNames, dotsLiteral, spreadIdentifier] = transformParameters(context, node.parameters, functionContext);
    const [transformedBody, functionScope] = transformFunctionBody(
        context,
        node.parameters,
        node.body,
        spreadIdentifier,
        node
    );

    const functionExpression = lua.createFunctionExpression(
        lua.createBlock(transformedBody),
        paramNames,
        dotsLiteral,
        flags,
        node
    );

    return [
        node.asteriskToken
            ? transformLuaLibFunction(context, LuaLibFeature.Generator, undefined, functionExpression)
            : functionExpression,
        functionScope,
    ];
}

export function transformFunctionLikeDeclaration(
    node: ts.FunctionLikeDeclaration,
    context: TransformationContext
): lua.Expression {
    if (node.body === undefined) {
        // This code can be reached only from object methods, which is TypeScript error
        return lua.createNilLiteral();
    }

    if (getNodeAnnotations(node).has(AnnotationKind.TupleReturn)) {
        context.diagnostics.push(annotationRemoved(node, AnnotationKind.TupleReturn));
    }

    const [functionExpression, functionScope] = transformFunctionToExpression(context, node);

    // Handle named function expressions which reference themselves
    if (ts.isFunctionExpression(node) && node.name && functionScope.referencedSymbols) {
        const symbol = context.checker.getSymbolAtLocation(node.name);
        if (symbol) {
            // TODO: Not using symbol ids because of https://github.com/microsoft/TypeScript/issues/37131
            const isReferenced = [...functionScope.referencedSymbols].some(([, nodes]) =>
                nodes.some(n => context.checker.getSymbolAtLocation(n)?.valueDeclaration === symbol.valueDeclaration)
            );

            // Only handle if the name is actually referenced inside the function
            if (isReferenced) {
                const nameIdentifier = transformIdentifier(context, node.name);
                context.addPrecedingStatements([
                    lua.createVariableDeclarationStatement(nameIdentifier, functionExpression),
                ]);
                return lua.cloneIdentifier(nameIdentifier);
            }
        }
    }

    return functionExpression;
}

export const transformFunctionDeclaration: FunctionVisitor<ts.FunctionDeclaration> = (node, context) => {
    if (getNodeAnnotations(node).has(AnnotationKind.TupleReturn)) {
        context.diagnostics.push(annotationRemoved(node, AnnotationKind.TupleReturn));
    }

    // Don't transform functions without body (overload declarations)
    if (node.body === undefined) {
        return undefined;
    }

    if (hasDefaultExportModifier(node)) {
        return lua.createAssignmentStatement(
            lua.createTableIndexExpression(createExportsIdentifier(), createDefaultExportStringLiteral(node)),
            transformFunctionLikeDeclaration(node, context)
        );
    }

    const [functionExpression, functionScope] = transformFunctionToExpression(context, node);

    // Name being undefined without default export is a TypeScript error
    const name = node.name ? transformIdentifier(context, node.name) : lua.createAnonymousIdentifier();

    // Remember symbols referenced in this function for hoisting later
    if (name.symbolId !== undefined) {
        const scope = peekScope(context);
        if (!scope.functionDefinitions) {
            scope.functionDefinitions = new Map();
        }

        const functionInfo = { referencedSymbols: functionScope.referencedSymbols ?? new Map() };
        scope.functionDefinitions.set(name.symbolId, functionInfo);
    }

    return createLocalOrExportedOrGlobalDeclaration(context, name, functionExpression, node);
};

export const transformYieldExpression: FunctionVisitor<ts.YieldExpression> = (expression, context) => {
    const parameters = expression.expression ? [context.transformExpression(expression.expression)] : [];
    return expression.asteriskToken
        ? transformLuaLibFunction(context, LuaLibFeature.DelegatedYield, expression, ...parameters)
        : lua.createCallExpression(
              lua.createTableIndexExpression(lua.createIdentifier("coroutine"), lua.createStringLiteral("yield")),
              parameters,
              expression
          );
};
