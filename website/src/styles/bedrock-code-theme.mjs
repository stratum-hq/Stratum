// The ANSI Strata syntax theme for Expressive Code, in VS Code theme format.
//
// A VS Code theme cannot read CSS variables, so the values below are copies of
// the dark text roles in assets/ansi/world.css and assets/tokens.css, the same
// colors the landing site's code listings use. When one changes, change it
// here too.
//
// The code well is dark in both site themes, so one theme serves both. Every
// foreground holds WCAG AA (4.5:1) on the well, #1A130F.
// Few colors on purpose: magma is kept for marked lines.

const well = "#1A130F"; // --well in custom.css
const text = "#F4EAD8"; // marl, --text-primary
const keyword = "#D2683C"; // clay, --t-kw
const fn = "#35C2A8"; // vein, --t-frame
const string = "#E0B266"; // sandstone band, --t-str
const number = "#FFB21E"; // amber, --t-num
const comment = "#C2B19A"; // silt, --text-secondary

export const bedrockCodeTheme = {
  name: "stratum-ansi-strata",
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
