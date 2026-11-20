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
  entryPoints: ["src/index.ts", "src/tenancy-provision.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: true,
  logLevel: "info",
  metafile: true,
  plugins: [externalizeThirdParty],
});

const outputs = result.metafile.outputs;
const externals = [
  ...new Set(
    Object.values(outputs)
      .flatMap((o) => o.imports)
      .filter((i) => i.external)
      .map((i) => i.path),
  ),
].sort();
const moduleCount = Object.keys(result.metafile.inputs).length;
const totalBytes = Object.values(outputs).reduce((sum, o) => sum + o.bytes, 0);

console.log(
  `\nBundled ${moduleCount} modules → ${Object.keys(outputs).length} files (${(totalBytes / 1024).toFixed(1)} kB), ${externals.length} externals:`,
);
for (const name of externals) console.log(`  - ${name}`);
