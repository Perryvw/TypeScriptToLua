import * as ts from "typescript";
import * as lua from "../../../LuaAST";
import { FunctionVisitor, TransformationContext } from "../../context";
import { AnnotationKind, getTypeAnnotations } from "../../utils/annotations";
import { annotationInvalidArgumentCount, annotationRemoved } from "../../utils/diagnostics";
import { importLuaLibFeature, LuaLibFeature, transformLuaLibFunction } from "../../utils/lualib";
import { transformArguments, transformCallAndArguments } from "../call";
import { isTableNewCall } from "../language-extensions/table";

const builtinErrorTypeNames = new Set([
    "Error",
    "ErrorConstructor",
    "RangeError",
    "RangeErrorConstructor",
    "ReferenceError",
    "ReferenceErrorConstructor",
    "SyntaxError",
    "SyntaxErrorConstructor",
    "TypeError",
    "TypeErrorConstructor",
    "URIError",
    "URIErrorConstructor",
]);

// TODO: Do it in identifier?
export function checkForLuaLibType(context: TransformationContext, type: ts.Type): void {
    if (!type.symbol) return;

    const name = context.checker.getFullyQualifiedName(type.symbol);
    switch (name) {
        case "Map":
            importLuaLibFeature(context, LuaLibFeature.Map);
            return;
        case "Set":
            importLuaLibFeature(context, LuaLibFeature.Set);
            return;
        case "WeakMap":
            importLuaLibFeature(context, LuaLibFeature.WeakMap);
            return;
        case "WeakSet":
            importLuaLibFeature(context, LuaLibFeature.WeakSet);
            return;
    }

    if (builtinErrorTypeNames.has(name)) {
        importLuaLibFeature(context, LuaLibFeature.Error);
    }
}

export const transformNewExpression: FunctionVisitor<ts.NewExpression> = (node, context) => {
    const type = context.checker.getTypeAtLocation(node);

    const annotations = getTypeAnnotations(type);

    if (annotations.has(AnnotationKind.LuaTable)) {
        context.diagnostics.push(annotationRemoved(node, AnnotationKind.LuaTable));
    }

    if (isTableNewCall(context, node)) {
        return lua.createTableExpression(undefined, node);
    }

    const signature = context.checker.getResolvedSignature(node);
    const [name, params] = transformCallAndArguments(
        context,
        node.expression,
        node.arguments ?? [ts.factory.createTrue()],
        signature
    );

    checkForLuaLibType(context, type);

    const customConstructorAnnotation = annotations.get(AnnotationKind.CustomConstructor);
    if (customConstructorAnnotation) {
        if (customConstructorAnnotation.args.length === 1) {
            return lua.createCallExpression(
                lua.createIdentifier(customConstructorAnnotation.args[0]),
                transformArguments(context, node.arguments ?? []),
                node
            );
        } else {
            context.diagnostics.push(
                annotationInvalidArgumentCount(
                    node,
                    AnnotationKind.CustomConstructor,
                    customConstructorAnnotation.args.length,
                    1
                )
            );
        }
    }

    return transformLuaLibFunction(context, LuaLibFeature.New, node, name, ...params);
};
