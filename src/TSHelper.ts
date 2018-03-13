import * as ts from "typescript";

export class TSHelper {
    // Get all children of a node, required until microsoft fixes node.getChildren()
    static getChildren(node: ts.Node): ts.Node[] {
        const children: ts.Node[] = [];
        node.forEachChild(child => {
            children.push(child);
        });
        return children;
    }

    // Get children filtered by function and cast to predefined type
    static getChildrenOfType<T>(node: ts.Node, typeFilter: (node: ts.Node) => boolean): T[] {
        return <T[]><any>this.getChildren(node).filter(typeFilter);
    }

    // Reverse lookup of enum key by value
    static enumName(needle, haystack) {
        for (var name in haystack) {
            if (haystack[name] == needle) {
                return name;
            }
        }
        return "unknown";
    }

    // Breaks down a mask into all flag names.
    static enumNames(mask, haystack) {
        let result = [mask];
        for (var name in haystack) {
            if ((mask & haystack[name]) != 0 && mask >= haystack[name]) {
                result.push(name);
            }
        }
        return result;
    }

    static containsStatement(statements: ts.NodeArray<ts.Statement>, kind: ts.SyntaxKind): boolean {
        return statements.some(statement => statement.kind === kind);
    }

    static isFileModule(sourceFile: ts.SourceFile) {
        if (sourceFile) {
            // Vanilla ts flags files as external module if they have an import or
            // export statement, we only check for export statements
            return sourceFile.statements.some(statement =>
                (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export) !== 0
                || statement.kind === ts.SyntaxKind.ExportAssignment
                || statement.kind === ts.SyntaxKind.ExportDeclaration)
        }
        return false;
    }

    static isStringType(type: ts.Type): boolean {
        return (type.flags & ts.TypeFlags.String) != 0
            || (type.flags & ts.TypeFlags.StringLike) != 0
            || (type.flags & ts.TypeFlags.StringLiteral) != 0
    }

    static isArrayType(type: ts.Type): boolean {
        return (type.flags & ts.TypeFlags.Object) != 0
            && (<ts.ObjectType>type).symbol
            && (<ts.ObjectType>type).symbol.escapedName == "Array";
    }

    static isTupleType(type: ts.Type): boolean {
        return (type.flags & ts.TypeFlags.Object) != 0
            && (<ts.TypeReference>type).typeArguments != undefined;
    }

    static isCompileMembersOnlyEnum(type: ts.Type, checker: ts.TypeChecker): boolean {
        return type.symbol
            && ((type.symbol.flags & ts.SymbolFlags.Enum) != 0)
            && type.symbol.getDocumentationComment(checker)[0] != undefined
            && this.hasCustomDecorator(type, checker, "!CompileMembersOnly");
    }

    static isPureAbstractClass(type: ts.Type, checker: ts.TypeChecker): boolean {
        return type.symbol
            && ((type.symbol.flags & ts.SymbolFlags.Class) != 0)
            && this.hasCustomDecorator(type, checker, "!PureAbstract");
    }

    static isExtensionClass(type: ts.Type, checker: ts.TypeChecker): boolean {
        return type.symbol
            && ((type.symbol.flags & ts.SymbolFlags.Class) != 0)
            && this.hasCustomDecorator(type, checker, "!Extension");
    }

    static isPhantom(type: ts.Type, checker: ts.TypeChecker): boolean {
        return type.symbol
            && ((type.symbol.flags & ts.SymbolFlags.Namespace) != 0)
            && this.hasCustomDecorator(type, checker, "!Phantom");
    }

    static isTupleReturnFunction(type: ts.Type, checker: ts.TypeChecker): boolean {
        return type.symbol
            && ((type.symbol.flags & ts.SymbolFlags.Function) != 0)
            &&  this.hasCustomDecorator(type, checker, "!TupleReturn");
    }

    static hasCustomDecorator(type: ts.Type, checker: ts.TypeChecker, decorator: string): boolean {
        if (type.symbol) {
            var comment = type.symbol.getDocumentationComment(checker);
            var decorators = comment.filter(_ => _.kind == "text").map(_ => _.text.trim()).filter(_ => _[0] == "!");
            return decorators.indexOf(decorator) > -1;
        }
        return false;
    }

    // Depth-First-Search up the inheritance tree for the name of the symbol containing the member
    static findMemberHolder(type: ts.Type, memberName: ts.__String, typeChecker: ts.TypeChecker): string {
        if (type.symbol.members.has(memberName) || (type.symbol.exports && type.symbol.exports.has(memberName))) {
            while (this.isExtensionClass(type, typeChecker)) {
                type = typeChecker.getBaseTypes(<ts.InterfaceType>type)[0];
            }
            return type.symbol.name;
        } else {
            for (let parent of typeChecker.getBaseTypes(<ts.InterfaceType>type)) {
                var parentMember = this.findMemberHolder(parent, memberName, typeChecker);
                if (parentMember) return parentMember;
            }
        }
    }

    // Search up until finding a node satisfying the callback
    static findFirstNodeAbove<T extends ts.Node>(node: ts.Node, callback: (n: ts.Node) => n is T): T {
        let current = node;
        while (current.parent) {
            if (callback(current.parent)) {
                return current.parent;
            } else {
                current = current.parent;
            }
        }
        return null;
    }
}
