import * as ts from "typescript";
import * as lua from "../../LuaAST";
import { FunctionVisitor, TransformationContext } from "../context";
import { awaitMustBeInAsyncFunction } from "../utils/diagnostics";
import { importLuaLibFeature, LuaLibFeature, transformLuaLibFunction } from "../utils/lualib";
import { isInAsyncFunction } from "../utils/typescript";

export const transformAwaitExpression: FunctionVisitor<ts.AwaitExpression> = (node, context) => {
    // Check if await is inside an async function, it is not allowed at top level or in non-async functions
    if (!isInAsyncFunction(node)) {
        context.diagnostics.push(awaitMustBeInAsyncFunction(node));
    }

    const expression = context.transformExpression(node.expression);
    const catchIdentifier = lua.createIdentifier("____catch");
    return transformLuaLibFunction(context, LuaLibFeature.Await, node, catchIdentifier, expression);
};

export function isAsyncFunction(declaration: ts.FunctionLikeDeclaration): boolean {
    return declaration.modifiers?.some(m => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false;
}

export function wrapInAsyncAwaiter(context: TransformationContext, statements: lua.Statement[]): lua.CallExpression {
    importLuaLibFeature(context, LuaLibFeature.Await);

    return lua.createCallExpression(lua.createIdentifier("__TS__AsyncAwaiter"), [
        lua.createFunctionExpression(lua.createBlock(statements), [
            lua.createIdentifier("____awaiter_resolve"),
            lua.createIdentifier("____awaiter_reject"),
        ]),
    ]);
}
