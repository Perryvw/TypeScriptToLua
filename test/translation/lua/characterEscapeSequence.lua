local quoteInDoubleQuotes = "\' \' \'"

local quoteInTemplateString = "\' \' \'"

local doubleQuoteInQuotes = "\" \" \""

local doubleQuoteInDoubleQuotes = "\" \" \""

local doubleQuoteInTemplateString = "\" \" \""

local escapedCharsInQuotes = "\\ \0 \b \t \n \v \f \" \' \`"

local escapedCharsInDoubleQUotes = "\\ \0 \b \t \n \v \f \" \' \`"

local escapedCharsInTemplateString = "\\ \0 \b \t \n \v \f \" \' \`"

local nonEmptyTemplateString = "Level 0: \n\t "..tostring("Level 1: \n\t\t "..tostring("Level 3: \n\t\t\t "..tostring("Last level \n --").." \n --").." \n --").." \n --"

