# TypescriptToLua
Typescript to lua transpiler.

[![Build Status](https://travis-ci.org/Perryvw/TypescriptToLua.svg?branch=master)](https://travis-ci.org/Perryvw/TypescriptToLua)

## Usage Guide

`npm install -g typescript-to-lua`

`tstl path/to-my-file.ts`

**Optionally:**
Add the lualib files from dist/ to your project. This helper library unlocks additional typescript functions:
- Ternary operator
- Functional-style list operations (forEach/map/filter/every/some)
- Includes lua `Map<S,T>` and `Set<T>` implementations
Add `require("typescript")` in your code code if you want to use the lualib functionality.

### Transpiling a TypeScript project to Lua
The compiler will automatically try to find a typescript configuration file `tsconfig.json` in the files. If found it will transpile all TypeScript files in subdirectories of the project.

**To prevent accidental compilation to Lua, you are required to add a `"target": "lua"` entry in your tsconfig compilerOptions.**

## Sublime Text integration
This compiler works great in combination with the [Sublime Text Typescript plugin](https://github.com/Microsoft/TypeScript-Sublime-Plugin) (available through the package manager as `TypeScript`).

You can simply open your typescript project assuming a valid tsconfig.json file is present. The default TypeScript plugin will provide all functionality of a regular TypeScript project.

### Setting up a custom build system
To add the option to build with the Lua transpiler instead of the regular typescript compiler, go to `Tools > Build System >  New Build System...`. In the new sublime-build file that opens, enter the following (adjust path to tstl if not installed globally):

```
{
    "cmd": ["tstl", "$file"]
}
```
Save this in your Sublime settings as a `TypeScriptToLua.sublime-build`. You can now select the TypeScriptToLua build system in `Tools > Build System` to build using the normal hotkey (`ctrl+B`), or if you have multiple TypeScript projects open, you can choose your compiler before building by pressing `ctrl+shift+B`.
