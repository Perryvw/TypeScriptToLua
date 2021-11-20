import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { transformBuiltinCallExpression } from "../builtins";
import { FunctionVisitor, TransformationContext } from "../context";
import { AnnotationKind, getTypeAnnotations, isTupleReturnCall } from "../utils/annotations";
import { validateAssignment } from "../utils/assignment-validation";
import { ContextType, getDeclarationContextType } from "../utils/function-context";
import { wrapInTable } from "../utils/lua-ast";
import { LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { isValidLuaIdentifier } from "../utils/safe-names";
import { isExpressionWithEvaluationEffect } from "../utils/typescript";
import { transformElementAccessArgument } from "./access";
import { isMultiReturnCall, shouldMultiReturnCallBeWrapped } from "./language-extensions/multi";
import { isOperatorMapping, transformOperatorMappingExpression } from "./language-extensions/operators";
import {
    isTableDeleteCall,
    isTableGetCall,
    isTableHasCall,
    isTableSetCall,
    transformTableDeleteExpression,
    transformTableGetExpression,
    transformTableHasExpression,
    transformTableSetExpression,
} from "./language-extensions/table";
import {
    annotationRemoved,
    invalidTableDeleteExpression,
    invalidTableSetExpression,
    notAllowedBuiltinOptionalCall,
} from "../utils/diagnostics";
import { moveToPrecedingTemp, transformExpressionList } from "./expression-list";
import { transformInPrecedingStatementScope } from "../utils/preceding-statements";
import { transformOptionalChain } from "./optional-chaining";
import { getInternalIdentifierData } from "../utils/typescript/internal-identifier";

export type PropertyCallExpression = ts.CallExpression & { expression: ts.PropertyAccessExpression };

export function validateArguments(
    context: TransformationContext,
    params: readonly ts.Expression[],
    signature?: ts.Signature
) {
    if (!signature || signature.parameters.length < params.length) {
        return;
    }
    for (const [index, param] of params.entries()) {
        const signatureParameter = signature.parameters[index];
        const paramType = context.checker.getTypeAtLocation(param);
        if (signatureParameter.valueDeclaration !== undefined) {
            const signatureType = context.checker.getTypeAtLocation(signatureParameter.valueDeclaration);
            validateAssignment(context, param, paramType, signatureType, signatureParameter.name);
        }
    }
}

export function transformArguments(
    context: TransformationContext,
    params: readonly ts.Expression[],
    signature?: ts.Signature,
    callContext?: ts.Expression
): lua.Expression[] {
    validateArguments(context, params, signature);
    return transformExpressionList(context, callContext ? [callContext, ...params] : params);
}

function transformCallWithArguments(
    context: TransformationContext,
    callExpression: ts.Expression,
    transformedArguments: lua.Expression[],
    argPrecedingStatements: lua.Statement[],
    callContext?: ts.Expression
): [lua.Expression, lua.Expression[]] {
    let call = context.transformExpression(callExpression);

    let transformedContext: lua.Expression | undefined;
    if (callContext) {
        transformedContext = context.transformExpression(callContext);
    }

    if (argPrecedingStatements.length > 0) {
        if (transformedContext) {
            transformedContext = moveToPrecedingTemp(context, transformedContext, callContext);
        }
        call = moveToPrecedingTemp(context, call, callExpression);
        context.addPrecedingStatements(argPrecedingStatements);
    }

    if (transformedContext) {
        transformedArguments.unshift(transformedContext);
    }

    return [call, transformedArguments];
}

export function transformCallAndArguments(
    context: TransformationContext,
    callExpression: ts.Expression,
    params: readonly ts.Expression[],
    signature?: ts.Signature,
    callContext?: ts.Expression
): [lua.Expression, lua.Expression[]] {
    const [argPrecedingStatements, transformedArguments] = transformInPrecedingStatementScope(context, () =>
        transformArguments(context, params, signature, callContext)
    );
    return transformCallWithArguments(context, callExpression, transformedArguments, argPrecedingStatements);
}

function transformElementAccessCall(
    context: TransformationContext,
    left: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    transformedArguments: lua.Expression[],
    argPrecedingStatements: lua.Statement[]
) {
    // Cache left-side if it has effects
    // local ____self = context; return ____self[argument](parameters);
    const selfIdentifier = lua.createIdentifier(context.createTempName("self"));
    const callContext = context.transformExpression(left.expression);
    const selfAssignment = lua.createVariableDeclarationStatement(selfIdentifier, callContext);
    context.addPrecedingStatements(selfAssignment);

    const argument = ts.isElementAccessExpression(left)
        ? transformElementAccessArgument(context, left)
        : lua.createStringLiteral(left.name.text);

    let index: lua.Expression = lua.createTableIndexExpression(selfIdentifier, argument);

    if (argPrecedingStatements.length > 0) {
        // Cache index in temp if args had preceding statements
        index = moveToPrecedingTemp(context, index);
        context.addPrecedingStatements(argPrecedingStatements);
    }

    return lua.createCallExpression(index, [selfIdentifier, ...transformedArguments]);
}

export function transformContextualCallExpression(
    context: TransformationContext,
    node: ts.CallExpression | ts.TaggedTemplateExpression,
    args: ts.Expression[] | ts.NodeArray<ts.Expression>,
    signature?: ts.Signature
): lua.Expression {
    if (ts.isOptionalChain(node)) {
        return transformOptionalChain(context, node);
    }
    const left = ts.isCallExpression(node) ? node.expression : node.tag;

    let [argPrecedingStatements, transformedArguments] = transformInPrecedingStatementScope(context, () =>
        transformArguments(context, args, signature)
    );

    if (
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.name) &&
        isValidLuaIdentifier(left.name.text) &&
        argPrecedingStatements.length === 0
    ) {
        // table:name()
        const table = context.transformExpression(left.expression);
        return lua.createMethodCallExpression(
            table,
            lua.createIdentifier(left.name.text, left.name),
            transformedArguments,
            node
        );
    } else if (ts.isElementAccessExpression(left) || ts.isPropertyAccessExpression(left)) {
        if (isExpressionWithEvaluationEffect(left.expression)) {
            return transformElementAccessCall(context, left, transformedArguments, argPrecedingStatements);
        } else {
            let expression: lua.Expression;
            [expression, transformedArguments] = transformCallWithArguments(
                context,
                left,
                transformedArguments,
                argPrecedingStatements,
                left.expression
            );
            return lua.createCallExpression(expression, transformedArguments, node);
        }
    } else if (ts.isIdentifier(left)) {
        const callContext = context.isStrict ? ts.factory.createNull() : ts.factory.createIdentifier("_G");
        let expression: lua.Expression;
        [expression, transformedArguments] = transformCallWithArguments(
            context,
            left,
            transformedArguments,
            argPrecedingStatements,
            callContext
        );
        return lua.createCallExpression(expression, transformedArguments, node);
    } else {
        throw new Error(`Unsupported LeftHandSideExpression kind: ${ts.SyntaxKind[left.kind]}`);
    }
}

function transformPropertyCall(context: TransformationContext, node: PropertyCallExpression): lua.Expression {
    const signature = context.checker.getResolvedSignature(node);

    if (node.expression.expression.kind === ts.SyntaxKind.SuperKeyword) {
        // Super calls take the format of super.call(self,...)
        const parameters = transformArguments(context, node.arguments, signature, ts.factory.createThis());
        return lua.createCallExpression(context.transformExpression(node.expression), parameters);
    }

    const signatureDeclaration = signature?.getDeclaration();
    if (!signatureDeclaration || getDeclarationContextType(context, signatureDeclaration) !== ContextType.Void) {
        // table:name()
        return transformContextualCallExpression(context, node, node.arguments, signature);
    } else {
        // table.name()
        const [callPath, parameters] = transformCallAndArguments(context, node.expression, node.arguments, signature);

        if (ts.isOptionalChain(node)) {
            return transformLuaLibFunction(context, LuaLibFeature.OptionalFunctionCall, node, callPath, ...parameters);
        } else {
            return lua.createCallExpression(callPath, parameters, node);
        }
    }
}

function transformElementCall(context: TransformationContext, node: ts.CallExpression): lua.Expression {
    const signature = context.checker.getResolvedSignature(node);
    const signatureDeclaration = signature?.getDeclaration();
    if (!signatureDeclaration || getDeclarationContextType(context, signatureDeclaration) !== ContextType.Void) {
        // A contextual parameter must be given to this call expression
        return transformContextualCallExpression(context, node, node.arguments, signature);
    } else {
        // No context
        const [expression, parameters] = transformCallAndArguments(context, node.expression, node.arguments, signature);
        return lua.createCallExpression(expression, parameters);
    }
}

export const transformCallExpression: FunctionVisitor<ts.CallExpression> = (node, context) => {
    if (ts.isOptionalChain(node)) {
        return transformOptionalChain(context, node);
    }

    const internalIdentifierData = ts.isIdentifier(node.expression)
        ? getInternalIdentifierData(node.expression)
        : undefined;
    const isOptionalBaseCall = internalIdentifierData?.isTransformedOptionalBase;

    const wrapResultInTable = isMultiReturnCall(context, node) && shouldMultiReturnCallBeWrapped(context, node);
    const builtinResult = transformBuiltinCallExpression(context, node);
    if (builtinResult) {
        if (isOptionalBaseCall) {
            context.diagnostics.push(notAllowedBuiltinOptionalCall(node));
        }
        return wrapResultInTable ? wrapInTable(builtinResult) : builtinResult;
    }

    if (isTupleReturnCall(context, node)) {
        context.diagnostics.push(annotationRemoved(node, AnnotationKind.TupleReturn));
    }

    if (isOperatorMapping(context, node)) {
        if (isOptionalBaseCall) {
            context.diagnostics.push(notAllowedBuiltinOptionalCall(node));
        }
        return transformOperatorMappingExpression(context, node);
    }

    if (isTableDeleteCall(context, node)) {
        context.diagnostics.push(invalidTableDeleteExpression(node));
        context.addPrecedingStatements(transformTableDeleteExpression(context, node));
        return lua.createNilLiteral();
    }

    if (isTableGetCall(context, node)) {
        if (isOptionalBaseCall) {
            context.diagnostics.push(notAllowedBuiltinOptionalCall(node));
        }
        return transformTableGetExpression(context, node);
    }

    if (isTableHasCall(context, node)) {
        if (isOptionalBaseCall) {
            context.diagnostics.push(notAllowedBuiltinOptionalCall(node));
        }
        return transformTableHasExpression(context, node);
    }

    if (isTableSetCall(context, node)) {
        context.diagnostics.push(invalidTableSetExpression(node));
        context.addPrecedingStatements(transformTableSetExpression(context, node));
        return lua.createNilLiteral();
    }

    if (ts.isPropertyAccessExpression(node.expression)) {
        const ownerType = context.checker.getTypeAtLocation(node.expression.expression);
        const annotations = getTypeAnnotations(ownerType);
        if (annotations.has(AnnotationKind.LuaTable)) {
            context.diagnostics.push(annotationRemoved(node, AnnotationKind.LuaTable));
        }

        const result = transformPropertyCall(context, node as PropertyCallExpression);
        return wrapResultInTable ? wrapInTable(result) : result;
    }

    if (ts.isElementAccessExpression(node.expression)) {
        const result = transformElementCall(context, node);
        return wrapResultInTable ? wrapInTable(result) : result;
    }

    const signature = context.checker.getResolvedSignature(node);

    // Handle super calls properly
    if (node.expression.kind === ts.SyntaxKind.SuperKeyword) {
        const parameters = transformArguments(context, node.arguments, signature, ts.factory.createThis());

        return lua.createCallExpression(
            lua.createTableIndexExpression(
                context.transformExpression(ts.factory.createSuper()),
                lua.createStringLiteral("____constructor")
            ),
            parameters
        );
    }

    const signatureDeclaration = signature?.getDeclaration();

    let callPath: lua.Expression;
    let parameters: lua.Expression[];
    let thisValueUsed = false;
    if (signatureDeclaration && getDeclarationContextType(context, signatureDeclaration) === ContextType.Void) {
        [callPath, parameters] = transformCallAndArguments(context, node.expression, node.arguments, signature);
    } else {
        const callContext = context.isStrict ? ts.factory.createNull() : ts.factory.createIdentifier("_G");
        thisValueUsed = true;
        [callPath, parameters] = transformCallAndArguments(
            context,
            node.expression,
            node.arguments,
            signature,
            callContext
        );
    }

    const callExpression = lua.createCallExpression(callPath, parameters, node);
    if (isOptionalBaseCall && thisValueUsed) {
        internalIdentifierData.optionalBaseContextualCall = callExpression;
    }
    return wrapResultInTable ? wrapInTable(callExpression) : callExpression;
};
