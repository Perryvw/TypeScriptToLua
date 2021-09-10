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
import { annotationRemoved, invalidTableDeleteExpression, invalidTableSetExpression } from "../utils/diagnostics";
import { moveToPrecedingTemp, transformExpressionList } from "./expression-list";

export type PropertyCallExpression = ts.CallExpression & { expression: ts.PropertyAccessExpression };

export function transformArguments(
    context: TransformationContext,
    params: readonly ts.Expression[],
    signature?: ts.Signature,
    callContext?: ts.Expression
): lua.Expression[] {
    context.pushPrecedingStatements();
    const parameters = transformExpressionList(context, params);
    const parametersPrecedingStatements = context.popPrecedingStatements();

    // Add context as first param if present
    if (callContext) {
        parameters.unshift(context.transformExpression(callContext));
    }

    // Defer parameter preceding statements in case transforming the context arg generates some as well
    context.addPrecedingStatements(parametersPrecedingStatements);

    if (signature && signature.parameters.length >= params.length) {
        for (const [index, param] of params.entries()) {
            const signatureParameter = signature.parameters[index];
            const paramType = context.checker.getTypeAtLocation(param);
            if (signatureParameter.valueDeclaration !== undefined) {
                const signatureType = context.checker.getTypeAtLocation(signatureParameter.valueDeclaration);
                validateAssignment(context, param, paramType, signatureType, signatureParameter.name);
            }
        }
    }

    return parameters;
}

function transformCallWithArgPrecedingStatements(
    context: TransformationContext,
    callExpression: ts.Expression,
    args: lua.Expression[],
    argPrecedingStatements: lua.Statement[],
    callContext?: ts.Expression
): [lua.Expression, lua.Expression[]] {
    let call = context.transformExpression(callExpression);

    args = args.slice();

    // Transform and inject context if given one
    if (callContext) {
        context.pushPrecedingStatements();
        const transformedContext = context.transformExpression(callContext);
        argPrecedingStatements = [...context.popPrecedingStatements(), ...argPrecedingStatements];
        args.unshift(transformedContext);
    }

    // Cache call expression and context arg in temps to preserve execution order
    if (argPrecedingStatements.length > 0) {
        call = moveToPrecedingTemp(context, call);
        if (callContext) {
            args[0] = moveToPrecedingTemp(context, args[0]);
        }
        context.addPrecedingStatements(argPrecedingStatements);
    }

    return [call, args];
}

export function transformCallAndArguments(
    context: TransformationContext,
    callExpression: ts.Expression,
    params: readonly ts.Expression[],
    signature?: ts.Signature,
    callContext?: ts.Expression
): [lua.Expression, lua.Expression[]] {
    context.pushPrecedingStatements();
    const args = transformArguments(context, params, signature, callContext);
    const precedingStatements = context.popPrecedingStatements();
    return transformCallWithArgPrecedingStatements(context, callExpression, args, precedingStatements);
}

function transformElementAccessCall(
    context: TransformationContext,
    left: ts.PropertyAccessExpression | ts.ElementAccessExpression,
    args: ts.Expression[] | ts.NodeArray<ts.Expression>,
    signature?: ts.Signature
) {
    // Cache left-side if it has effects
    // local ____self = context; return ____self[argument](parameters);
    const selfIdentifier = lua.createIdentifier(context.createTempName("self"));
    const callContext = context.transformExpression(left.expression);
    const selfAssignment = lua.createVariableDeclarationStatement(selfIdentifier, callContext);
    context.addPrecedingStatements([selfAssignment]);

    const argument = ts.isElementAccessExpression(left)
        ? transformElementAccessArgument(context, left)
        : lua.createStringLiteral(left.name.text);

    let index: lua.Expression = lua.createTableIndexExpression(selfIdentifier, argument);

    context.pushPrecedingStatements();

    const transformedArguments = transformArguments(
        context,
        args,
        signature,
        ts.factory.createIdentifier(selfIdentifier.text)
    );

    const argPrecedingStatements = context.popPrecedingStatements();
    if (argPrecedingStatements.length > 0) {
        // Cache index in temp if args had preceding statements
        index = moveToPrecedingTemp(context, index);
        context.addPrecedingStatements(argPrecedingStatements);
    }

    return lua.createCallExpression(index, transformedArguments);
}

export function transformContextualCallExpression(
    context: TransformationContext,
    node: ts.CallExpression | ts.TaggedTemplateExpression,
    args: ts.Expression[] | ts.NodeArray<ts.Expression>,
    signature?: ts.Signature
): lua.CallExpression | lua.MethodCallExpression {
    const left = ts.isCallExpression(node) ? node.expression : node.tag;

    context.pushPrecedingStatements();
    const transformedArguments = transformArguments(context, args, signature);
    const argPrecedingStatements = context.popPrecedingStatements();

    if (
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.name) &&
        isValidLuaIdentifier(left.name.text) &&
        argPrecedingStatements.length === 0
    ) {
        // table:name()
        const table = context.transformExpression(left.expression);

        if (ts.isOptionalChain(node)) {
            return transformLuaLibFunction(
                context,
                LuaLibFeature.OptionalMethodCall,
                node,
                table,
                lua.createStringLiteral(left.name.text, left.name),
                lua.createBooleanLiteral(node.questionDotToken !== undefined), // Require method is present if no ?.() call
                ...transformedArguments
            );
        } else {
            return lua.createMethodCallExpression(
                table,
                lua.createIdentifier(left.name.text, left.name),
                transformedArguments,
                node
            );
        }
    } else if (ts.isElementAccessExpression(left) || ts.isPropertyAccessExpression(left)) {
        if (isExpressionWithEvaluationEffect(left.expression)) {
            return transformElementAccessCall(context, left, args, signature);
        } else {
            const [expression, updatedArgs] = transformCallWithArgPrecedingStatements(
                context,
                left,
                transformedArguments,
                argPrecedingStatements,
                left.expression
            );
            return lua.createCallExpression(expression, updatedArgs, node);
        }
    } else if (ts.isIdentifier(left)) {
        const callContext = context.isStrict ? lua.createNilLiteral() : lua.createIdentifier("_G");
        const [expression, updatedArgs] = transformCallWithArgPrecedingStatements(
            context,
            left,
            transformedArguments,
            argPrecedingStatements
        );
        return lua.createCallExpression(expression, [callContext, ...updatedArgs], node);
    } else {
        throw new Error(`Unsupported LeftHandSideExpression kind: ${ts.SyntaxKind[left.kind]}`);
    }
}

function transformPropertyCall(
    context: TransformationContext,
    node: PropertyCallExpression
): lua.CallExpression | lua.MethodCallExpression {
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

function transformElementCall(
    context: TransformationContext,
    node: ts.CallExpression
): lua.CallExpression | lua.MethodCallExpression {
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
    const wrapResultInTable = isMultiReturnCall(context, node) && shouldMultiReturnCallBeWrapped(context, node);
    const wrapResultInOptional = ts.isOptionalChain(node);

    const builtinResult = transformBuiltinCallExpression(context, node);
    if (builtinResult) {
        return wrapResultInTable ? wrapInTable(builtinResult) : builtinResult;
    }

    if (isTupleReturnCall(context, node)) {
        context.diagnostics.push(annotationRemoved(node, AnnotationKind.TupleReturn));
    }

    if (isOperatorMapping(context, node)) {
        return transformOperatorMappingExpression(context, node);
    }

    if (isTableDeleteCall(context, node)) {
        context.diagnostics.push(invalidTableDeleteExpression(node));
        context.addPrecedingStatements([transformTableDeleteExpression(context, node)]);
        return lua.createNilLiteral();
    }

    if (isTableGetCall(context, node)) {
        return transformTableGetExpression(context, node);
    }

    if (isTableHasCall(context, node)) {
        return transformTableHasExpression(context, node);
    }

    if (isTableSetCall(context, node)) {
        context.diagnostics.push(invalidTableSetExpression(node));
        context.addPrecedingStatements([transformTableSetExpression(context, node)]);
        return lua.createNilLiteral();
    }

    if (ts.isPropertyAccessExpression(node.expression)) {
        const ownerType = context.checker.getTypeAtLocation(node.expression.expression);
        const annotations = getTypeAnnotations(ownerType);
        if (annotations.has(AnnotationKind.LuaTable)) {
            context.diagnostics.push(annotationRemoved(node, AnnotationKind.LuaTable));
        }

        const result = transformPropertyCall(context, node as PropertyCallExpression);
        // transformPropertyCall already wraps optional so no need to do so here
        return wrapResultInTable ? wrapInTable(result) : result;
    }

    if (ts.isElementAccessExpression(node.expression)) {
        const result = transformElementCall(context, node);
        return wrapIfRequired(context, wrapResultInTable, wrapResultInOptional, result, node);
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
    let parameters: lua.Expression[] = [];
    if (signatureDeclaration && getDeclarationContextType(context, signatureDeclaration) === ContextType.Void) {
        [callPath, parameters] = transformCallAndArguments(context, node.expression, node.arguments, signature);
    } else {
        const callContext = context.isStrict ? ts.factory.createNull() : ts.factory.createIdentifier("_G");
        [callPath, parameters] = transformCallAndArguments(
            context,
            node.expression,
            node.arguments,
            signature,
            callContext
        );
    }

    const callExpression = lua.createCallExpression(callPath, parameters, node);
    return wrapIfRequired(context, wrapResultInTable, wrapResultInOptional, callExpression, node);
};

function wrapIfRequired(
    context: TransformationContext,
    shouldWrapInTable: boolean,
    shouldWrapOptional: boolean,
    call: lua.CallExpression | lua.MethodCallExpression,
    node: ts.CallExpression
): lua.Expression {
    const wrappedOptional = shouldWrapOptional ? wrapOptionalCall(context, call, node) : call;
    return shouldWrapInTable ? wrapInTable(wrappedOptional) : wrappedOptional;
}

function wrapOptionalCall(
    context: TransformationContext,
    call: lua.CallExpression | lua.MethodCallExpression,
    node: ts.CallExpression
): lua.CallExpression {
    if (lua.isMethodCallExpression(call)) {
        return transformLuaLibFunction(
            context,
            LuaLibFeature.OptionalMethodCall,
            node,
            call.prefixExpression,
            lua.createStringLiteral(call.name.text),
            lua.createBooleanLiteral(node.questionDotToken !== undefined), // Require method is present if no ?.() call
            ...call.params
        );
    } else {
        return transformLuaLibFunction(
            context,
            LuaLibFeature.OptionalFunctionCall,
            node,
            call.expression,
            ...call.params
        );
    }
}
