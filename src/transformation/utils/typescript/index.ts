import * as ts from "typescript";
import { TransformationContext } from "../../context";

export * from "./nodes";
export * from "./types";

// TODO: Move to separate files?

export function hasExportEquals(sourceFile: ts.SourceFile): boolean {
    return sourceFile.statements.some(node => ts.isExportAssignment(node) && node.isExportEquals);
}

/**
 * Search up until finding a node satisfying the callback
 */
export function findFirstNodeAbove<T extends ts.Node>(node: ts.Node, callback: (n: ts.Node) => n is T): T | undefined {
    let current = node;
    while (current.parent) {
        if (callback(current.parent)) {
            return current.parent;
        } else {
            current = current.parent;
        }
    }
}

export function getFirstDeclarationInFile(symbol: ts.Symbol, sourceFile: ts.SourceFile): ts.Declaration | undefined {
    const originalSourceFile = ts.getParseTreeNode(sourceFile) ?? sourceFile;
    const declarations = (symbol.getDeclarations() ?? []).filter(d => d.getSourceFile() === originalSourceFile);

    return declarations.length > 0 ? declarations.reduce((p, c) => (p.pos < c.pos ? p : c)) : undefined;
}

function isStandardLibraryDeclaration(context: TransformationContext, declaration: ts.Declaration): boolean {
    const parseTreeNode = ts.getParseTreeNode(declaration) ?? declaration;
    const sourceFile = parseTreeNode.getSourceFile();
    if (!sourceFile) {
        return false;
    }

    return context.program.isSourceFileDefaultLibrary(sourceFile);
}

export function isStandardLibraryType(
    context: TransformationContext,
    type: ts.Type,
    name: string | undefined
): boolean {
    const symbol = type.getSymbol();
    if (!symbol || (name ? symbol.name !== name : symbol.name === "__type")) {
        return false;
    }

    // Assume to be lib function if no valueDeclaration exists
    const declaration = symbol.valueDeclaration;
    if (!declaration) {
        return true;
    }

    return isStandardLibraryDeclaration(context, declaration);
}

export function hasStandardLibrarySignature(
    context: TransformationContext,
    callExpression: ts.CallExpression
): boolean {
    const signature = context.checker.getResolvedSignature(callExpression);
    return signature?.declaration ? isStandardLibraryDeclaration(context, signature.declaration) : false;
}

export function inferAssignedType(context: TransformationContext, expression: ts.Expression): ts.Type {
    return context.checker.getContextualType(expression) ?? context.checker.getTypeAtLocation(expression);
}

export function getAllCallSignatures(type: ts.Type): readonly ts.Signature[] {
    return type.isUnion() ? type.types.flatMap(getAllCallSignatures) : type.getCallSignatures();
}

// Returns true for expressions that may have effects when evaluated
export function isExpressionWithEvaluationEffect(node: ts.Expression): boolean {
    return !(ts.isLiteralExpression(node) || ts.isIdentifier(node) || node.kind === ts.SyntaxKind.ThisKeyword);
}

export function getFunctionTypeForCall(context: TransformationContext, node: ts.CallExpression) {
    const signature = context.checker.getResolvedSignature(node);
    if (!signature || !signature.declaration) {
        return;
    }
    const typeDeclaration = findFirstNodeAbove(signature.declaration, ts.isTypeAliasDeclaration);
    if (!typeDeclaration) {
        return;
    }
    return context.checker.getTypeFromTypeNode(typeDeclaration.type);
}

export function isConstIdentifier(context: TransformationContext, node: ts.Node) {
    let identifier = node;
    if (ts.isComputedPropertyName(identifier)) {
        identifier = identifier.expression;
    }
    if (!ts.isIdentifier(identifier)) {
        return false;
    }
    const symbol = context.checker.getSymbolAtLocation(identifier);
    if (!symbol || !symbol.declarations) {
        return false;
    }
    return symbol.declarations.some(
        d => ts.isVariableDeclarationList(d.parent) && (d.parent.flags & ts.NodeFlags.Const) !== 0
    );
}
