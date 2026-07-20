// Every module the shell loads, in nav order. Adding a future module
// (Sarek gear, tasks, calendar) is one new folder + one line here —
// nothing else in shell/ needs to change.
export const MODULES = [
  {
    id: "morning-brief",
    path: "./morning-brief/module.js",
    css: "./morning-brief/module.css",
  },
  // { id: "sarek-gear", path: "./sarek-gear/module.js", css: "./sarek-gear/module.css" },
];
