// Every module the shell loads, in nav order. Adding a future module
// (Sarek gear, tasks, calendar) is one new folder + one line here —
// nothing else in shell/ needs to change.
//
// `path`/`css` are resolved relative to THIS file's own location (i.e.
// relative to web/modules/) via MODULES_BASE_URL in module-registry.js —
// not relative to whichever file happens to call import(), which is a
// different (and easy to get wrong) thing for dynamic imports.
export const MODULES_BASE_URL = import.meta.url;

export const MODULES = [
  {
    id: "morning-brief",
    path: "./morning-brief/module.js",
    css: "./morning-brief/module.css",
  },
  {
    id: "sarek-gear",
    path: "./sarek-gear/module.js",
    css: "./sarek-gear/module.css",
  },
  {
    id: "portfolio",
    path: "./portfolio/module.js",
    css: "./portfolio/module.css",
  },
  {
    id: "access-log",
    path: "./access-log/module.js",
    css: "./access-log/module.css",
  },
  {
    id: "todo",
    path: "./todo/module.js",
    css: "./todo/module.css",
  },
];
