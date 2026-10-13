import { build } from "esbuild";
import { isBuiltin } from "node:module";

// Bundle the app and every @loyaltyos/* workspace package into a single ESM
// file. Workspace packages ship `main` pointing at TypeScript *source*
// ("./src/index.ts"), so they must be inlined here — Node cannot resolve them
// at runtime. Third-party dependencies (and Node built-ins) stay external and
// are resolved from node_modules at runtime, which keeps native modules
// (argon2, @prisma/client) and dynamic imports (@opentelemetry/*) working.
const externalizeThirdParty = {
  name: "externalize-third-party",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.kind === "entry-point") return null;
      if (args.path.startsWith("@loyaltyos/")) return null;
      if (isBuiltin(args.path)) return null;
      return { path: args.path, external: true };
    });
  },
};

const result = await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  metafile: true,
  plugins: [externalizeThirdParty],
});

const output = result.metafile.outputs["dist/index.js"];
const externals = [...new Set(output.imports.filter((i) => i.external).map((i) => i.path))].sort();
const moduleCount = Object.keys(result.metafile.inputs).length;
const bundleBytes = output.bytes;

console.log(
  `\nBundled ${moduleCount} modules → dist/index.js (${(bundleBytes / 1024).toFixed(1)} kB), ${externals.length} externals:`,
);
for (const name of externals) console.log(`  - ${name}`);
