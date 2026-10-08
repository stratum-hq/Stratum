// The Bedrock syntax theme for Expressive Code, in VS Code theme format.
//
// A VS Code theme cannot read CSS variables, so the values below are copies of
// the code tokens in assets/tokens.css (--code-bg, --code-text, --syntax-*).
// When one of those tokens changes, change it here too.
//
// The code well is dark in both site themes, so one theme serves Bedrock and
// Daylight. Every foreground holds WCAG AA (4.5:1) on #0C0907.
// Few colors on purpose: magma is kept for marked lines.

const well = "#0C0907";
const text = "#D6C3A0"; // --code-text, 11.5:1
const keyword = "#C09AB3"; // --syntax-keyword, 8.1:1
const fn = "#35C2A8"; // --syntax-function (vein), 8.9:1
const string = "#E0B266"; // --syntax-string (sandstone band), 10.1:1
const number = "#FFB21E"; // --syntax-number (amber), 11.0:1
const comment = "#9A8670"; // --syntax-comment, 5.7:1

export const bedrockCodeTheme = {
  name: "stratum-bedrock",
  type: "dark",
  colors: {
    "editor.background": well,
    "editor.foreground": text,
    "editor.selectionBackground": "#FF5B1F40",
    "editorLineNumber.foreground": comment,
    "terminal.foreground": text,
    "terminal.background": well,
  },
  tokenColors: [
    { settings: { foreground: text, background: well } },
    {
      scope: ["comment", "punctuation.definition.comment", "string.comment"],
      settings: { foreground: comment },
    },
    {
      scope: [
        "keyword",
        "keyword.control",
        "keyword.operator.new",
        "keyword.operator.expression",
        "storage",
        "storage.type",
        "storage.modifier",
      ],
      settings: { foreground: keyword },
    },
    {
      scope: [
        "entity.name.function",
        "support.function",
        "meta.function-call entity.name.function",
        "variable.function",
      ],
      settings: { foreground: fn },
    },
    {
      scope: [
        "string",
        "string.quoted",
        "string.template",
        "punctuation.definition.string",
        "markup.inline.raw",
      ],
      settings: { foreground: string },
    },
    {
      scope: ["constant.numeric", "constant.language", "constant.character", "support.constant"],
      settings: { foreground: number },
    },
    {
      scope: ["markup.heading", "markup.bold", "entity.name.section"],
      settings: { foreground: text, fontStyle: "bold" },
    },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    {
      scope: ["markup.inserted", "punctuation.definition.inserted"],
      settings: { foreground: fn },
    },
    {
      scope: ["markup.deleted", "punctuation.definition.deleted"],
      settings: { foreground: "#FF6A33" },
    },
  ],
};
