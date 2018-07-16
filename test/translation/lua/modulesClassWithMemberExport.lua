local exports = exports or {}
local TestClass = TestClass or {}
TestClass.__index = TestClass
function TestClass.new(construct, ...)
    local instance = setmetatable({}, TestClass)
    if construct and TestClass.constructor then TestClass.constructor(instance, ...) end
    return instance
end
function TestClass.constructor(self)
end
function TestClass.memberFunc(self)
end
exports.TestClass = TestClass
return exports
